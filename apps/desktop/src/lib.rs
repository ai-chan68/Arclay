mod db;

use serde::Deserialize;
use serde_json::Value;
use sqlx::{Row, Column};
use sqlx::sqlite::SqlitePool;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::sync::Notify;
#[cfg(debug_assertions)]
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

const DEFAULT_API_PORT: u16 = 2026;
const DESKTOP_SIDECAR_PROTOCOL: u16 = 1;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiHealthResponse {
    status: String,
    desktop_sidecar_protocol: Option<u16>,
}

// Global variable to store the API port
static API_PORT: AtomicU16 = AtomicU16::new(2026);

// Global database pool
static DB_POOL: OnceLock<SqlitePool> = OnceLock::new();

// Database initialization notifier
static DB_READY: OnceLock<Arc<Notify>> = OnceLock::new();

// Store sidecar child process for cleanup on exit
static SIDECAR_CHILD: OnceLock<std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>> = OnceLock::new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            get_api_port,
            is_desktop,
            db_execute,
            db_query
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                // Keep devtools opt-in in development so desktop startup does not
                // automatically enter developer mode during normal local runs.
                let should_open_devtools = std::env::var("ARCLAY_OPEN_DEVTOOLS")
                    .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                    .unwrap_or(false);

                if should_open_devtools {
                    if let Some(window) = app.get_webview_window("main") {
                        window.open_devtools();
                    }
                }
            }

            // Initialize database asynchronously to avoid blocking startup
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match init_database(&app_handle).await {
                    Ok(_) => {
                        println!("[DB] Database initialized successfully");
                        // Notify waiting database commands
                        if let Some(notify) = DB_READY.get() {
                            notify.notify_waiters();
                        }
                    }
                    Err(e) => eprintln!("[DB] Database initialization failed: {}", e),
                }
            });

            let spawn_sidecar_in_dev = std::env::var("ARCLAY_SPAWN_SIDECAR_IN_DEV")
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false);
            let should_spawn_sidecar = !cfg!(debug_assertions) || spawn_sidecar_in_dev;

            if should_spawn_sidecar {
                let default_port = DEFAULT_API_PORT;
                if is_api_compatible(default_port) {
                    API_PORT.store(default_port, Ordering::SeqCst);
                    println!(
                        "[API] Compatible API already running on port {}, skipping sidecar spawn",
                        default_port
                    );
                    return Ok(());
                }

                if is_api_already_running(default_port) {
                    println!(
                        "[API] Existing API on port {} is not desktop-sidecar compatible, starting bundled sidecar anyway",
                        default_port
                    );
                } else {
                    println!("[API] No existing API detected, starting sidecar");
                }

                // Spawn API sidecar
                let shell = app.shell();
                let sidecar_command = match shell.sidecar("arclay-api") {
                    Ok(command) => command,
                    Err(e) => {
                        eprintln!("Failed to prepare API sidecar command: {}", e);
                        #[cfg(debug_assertions)]
                        println!("Running in dev mode - API should be started separately with 'pnpm dev:api'");
                        return Ok(());
                    }
                };

                // Set environment variable for sidecar detection
                std::env::set_var("TAURI_FAMILY", "sidecar");

                match sidecar_command.spawn() {
                    Ok((mut rx, child)) => {
                        println!("API sidecar started successfully");

                        // Store child process for cleanup on exit
                        SIDECAR_CHILD.get_or_init(|| std::sync::Mutex::new(Some(child)));

                        // Handle sidecar output in a separate thread
                        tauri::async_runtime::spawn(async move {
                            use tauri_plugin_shell::process::CommandEvent;
                            while let Some(event) = rx.recv().await {
                                match event {
                                    CommandEvent::Stdout(line) => {
                                        let output = String::from_utf8_lossy(&line);
                                        if let Some(port) = parse_api_port_from_sidecar_output(output.as_ref()) {
                                            API_PORT.store(port, Ordering::SeqCst);
                                            println!("[API] Active API port updated to {}", port);
                                        }
                                        println!("[API] {}", output);
                                    }
                                    CommandEvent::Stderr(line) => {
                                        eprintln!("[API ERR] {}", String::from_utf8_lossy(&line));
                                    }
                                    CommandEvent::Error(err) => {
                                        eprintln!("[API ERROR] {}", err);
                                    }
                                    CommandEvent::Terminated(payload) => {
                                        println!("[API] Sidecar terminated with code: {:?}", payload.code);
                                    }
                                    _ => {}
                                }
                            }
                        });
                    }
                    Err(e) => {
                        eprintln!("Failed to start API sidecar: {}", e);
                        // In development mode, the API might be running separately
                        #[cfg(debug_assertions)]
                        println!("Running in dev mode - API should be started separately with 'pnpm dev:api'");
                    }
                }
            } else {
                println!(
                    "[API] Dev mode: using external API server on http://localhost:2026 (sidecar disabled)"
                );
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // On macOS, hide window instead of closing when user clicks X
                #[cfg(target_os = "macos")]
                {
                    window.hide().unwrap();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            use tauri::Manager;

            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                // When user clicks Dock icon, show the main window
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            // Clean up sidecar process on exit
            match event {
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                    println!("[API] Exit event received, cleaning up sidecar");
                    if let Some(sidecar_mutex) = SIDECAR_CHILD.get() {
                        if let Ok(mut guard) = sidecar_mutex.lock() {
                            if let Some(child) = guard.take() {
                                println!("[API] Terminating sidecar process (PID: {:?})", child.pid());
                                match child.kill() {
                                    Ok(_) => println!("[API] Sidecar terminated successfully"),
                                    Err(e) => eprintln!("[API] Failed to terminate sidecar: {}", e),
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        });
}

/// Initialize the database connection pool
async fn init_database(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::path::BaseDirectory;
    use tauri::Manager;

    // Initialize notifier if not already set
    DB_READY.get_or_init(|| Arc::new(Notify::new()));

    let app_data_dir = app.path().resolve("arclay.db", BaseDirectory::AppData)?;
    let db_path = app_data_dir.to_string_lossy().to_string();

    // Ensure parent directory exists
    if let Some(parent) = app_data_dir.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let database_url = format!("sqlite:{}?mode=rwc", db_path);
    println!("[DB] Connecting to: {}", database_url);

    let pool = db::initialize_database(&database_url).await?;

    // Store pool globally
    DB_POOL.set(pool).map_err(|_| "Database pool already initialized")?;

    println!("[DB] Database initialized successfully");
    Ok(())
}

/// Check if API is already running by attempting to connect
fn is_api_already_running(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(100)
    ).is_ok()
}

fn is_api_compatible(port: u16) -> bool {
    fetch_api_health_response(port)
        .map(|response| is_compatible_api_health_response(&response))
        .unwrap_or(false)
}

fn fetch_api_health_response(port: u16) -> Option<String> {
    let mut stream = TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().ok()?,
        Duration::from_millis(150)
    ).ok()?;

    let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(300)));

    let request = format!(
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        port
    );
    stream.write_all(request.as_bytes()).ok()?;

    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;

    let (_, body) = response.split_once("\r\n\r\n")?;
    Some(body.trim().to_string())
}

fn is_compatible_api_health_response(body: &str) -> bool {
    serde_json::from_str::<ApiHealthResponse>(body)
        .map(|health| {
            health.status == "ok"
                && health.desktop_sidecar_protocol.unwrap_or(0) >= DESKTOP_SIDECAR_PROTOCOL
        })
        .unwrap_or(false)
}

fn parse_api_port_from_sidecar_output(output: &str) -> Option<u16> {
    output.lines().find_map(|line| {
        let (_, port) = line.trim().split_once("API server running on http://localhost:")?;
        port.parse::<u16>().ok()
    })
}

/// Tauri command to get the API port
#[tauri::command]
fn get_api_port() -> u16 {
    API_PORT.load(Ordering::SeqCst)
}

/// Tauri command to check if running in Tauri
#[tauri::command]
fn is_desktop() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::{
        is_compatible_api_health_response,
        parse_api_port_from_sidecar_output,
    };

    #[test]
    fn parses_sidecar_port_from_startup_log_line() {
        assert_eq!(
            parse_api_port_from_sidecar_output("API server running on http://localhost:2027"),
            Some(2027)
        );
    }

    #[test]
    fn rejects_old_health_payload_without_sidecar_protocol_marker() {
        assert!(!is_compatible_api_health_response(
            r#"{"status":"ok","timestamp":"2026-04-07T14:54:23.312Z"}"#
        ));
    }

    #[test]
    fn accepts_health_payload_with_sidecar_protocol_marker() {
        assert!(is_compatible_api_health_response(
            r#"{"status":"ok","timestamp":"2026-04-07T14:54:23.312Z","desktopSidecarProtocol":1}"#
        ));
    }
}

/// Execute a SQL statement (INSERT, UPDATE, DELETE, etc.)
/// Returns the number of rows affected
#[tauri::command]
async fn db_execute(sql: String, params: Vec<Value>) -> Result<u64, String> {
    // Wait for database to be ready if not initialized yet
    if DB_POOL.get().is_none() {
        if let Some(notify) = DB_READY.get() {
            notify.notified().await;
        }
    }

    let pool = DB_POOL.get().ok_or("Database not initialized")?;

    let mut query = sqlx::query(&sql);
    for param in &params {
        query = bind_value(query, param);
    }

    let result = query
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("[DB] Execute error: {}", e);
            format!("Database execute error: {}", e)
        })?;

    Ok(result.rows_affected())
}

/// Query the database and return results as JSON
#[tauri::command]
async fn db_query(sql: String, params: Vec<Value>) -> Result<Vec<serde_json::Map<String, Value>>, String> {
    // Wait for database to be ready if not initialized yet
    if DB_POOL.get().is_none() {
        if let Some(notify) = DB_READY.get() {
            notify.notified().await;
        }
    }

    let pool = DB_POOL.get().ok_or("Database not initialized")?;

    let mut query = sqlx::query(&sql);
    for param in &params {
        query = bind_value(query, param);
    }

    let rows = query
        .fetch_all(pool)
        .await
        .map_err(|e| {
            eprintln!("[DB] Query error: {}", e);
            format!("Database query error: {}", e)
        })?;

    // Convert rows to JSON maps
    let results: Vec<serde_json::Map<String, Value>> = rows
        .iter()
        .map(|row| {
            let mut map = serde_json::Map::new();
            for (i, col) in row.columns().iter().enumerate() {
                let value = row_try_get_json_value(row, i);
                map.insert(col.name().to_string(), value);
            }
            map
        })
        .collect();

    Ok(results)
}

/// Bind a JSON value to a SQL query
fn bind_value<'q>(query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>, value: &'q Value) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    match value {
        Value::Null => query.bind(None::<String>),
        Value::Bool(b) => query.bind(b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                query.bind(i)
            } else if let Some(f) = n.as_f64() {
                query.bind(f)
            } else {
                query.bind(n.to_string())
            }
        }
        Value::String(s) => query.bind(s),
        Value::Array(_) | Value::Object(_) => query.bind(value.to_string()),
    }
}

/// Try to get a JSON value from a database row
fn row_try_get_json_value(row: &sqlx::sqlite::SqliteRow, i: usize) -> Value {
    // Try different types in order
    if let Ok(v) = row.try_get::<Option<String>, _>(i) {
        return v.map(Value::String).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
        return v.map(|n| Value::Number(n.into())).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
        return v
            .map(|n| serde_json::Number::from_f64(n).map(Value::Number).unwrap_or(Value::Null))
            .unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<Option<bool>, _>(i) {
        return v.map(Value::Bool).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(i) {
        return v.map(|bytes| Value::Array(bytes.into_iter().map(|b| Value::Number(b.into())).collect())).unwrap_or(Value::Null);
    }
    Value::Null
}
