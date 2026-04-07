mod db;

use serde_json::Value;
use sqlx::{Row, Column};
use sqlx::sqlite::SqlitePool;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::sync::Notify;
#[cfg(debug_assertions)]
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

// Global variable to store the API port (0 means not ready yet)
static API_PORT: AtomicU16 = AtomicU16::new(0);

// Global database pool
static DB_POOL: OnceLock<SqlitePool> = OnceLock::new();

// Database initialization notifier
static DB_READY: OnceLock<Arc<Notify>> = OnceLock::new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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
                // Check if API is already running on default port
                let default_port = 2026;
                if is_port_available(default_port) {
                    println!("[API] Port {} is available, starting sidecar", default_port);
                } else {
                    println!("[API] Port {} already in use, assuming API is running", default_port);
                    API_PORT.store(default_port, Ordering::SeqCst);
                    return Ok(());
                }

                // Spawn API sidecar
                let shell = app.shell();
                let sidecar_command = match shell.sidecar("arclay-api") {
                    Ok(command) => command,
                    Err(e) => {
                        API_PORT.store(2026, Ordering::SeqCst);
                        eprintln!("Failed to prepare API sidecar command: {}", e);
                        #[cfg(debug_assertions)]
                        println!("Running in dev mode - API should be started separately with 'pnpm dev:api'");
                        return Ok(());
                    }
                };

                // Set environment variable for sidecar detection
                std::env::set_var("TAURI_FAMILY", "sidecar");

                match sidecar_command.spawn() {
                    Ok((mut rx, _pid)) => {
                        println!("API sidecar started successfully");

                        // Store the port (default 2026, but sidecar may use different port)
                        API_PORT.store(2026, Ordering::SeqCst);

                        // Handle sidecar output in a separate thread
                        tauri::async_runtime::spawn(async move {
                            use tauri_plugin_shell::process::CommandEvent;
                            while let Some(event) = rx.recv().await {
                                match event {
                                    CommandEvent::Stdout(line) => {
                                        let output = String::from_utf8_lossy(&line);
                                        println!("[API] {}", output);

                                        // Parse port from output
                                        if output.contains("running on http://localhost:") {
                                            if let Some(port_str) = output.split(':').last() {
                                                if let Ok(port) = port_str.trim().parse::<u16>() {
                                                    API_PORT.store(port, Ordering::SeqCst);
                                                    println!("API server port: {}", port);
                                                }
                                            }
                                        }
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
                        API_PORT.store(2026, Ordering::SeqCst);
                        eprintln!("Failed to start API sidecar: {}", e);
                        // In development mode, the API might be running separately
                        #[cfg(debug_assertions)]
                        println!("Running in dev mode - API should be started separately with 'pnpm dev:api'");
                    }
                }
            } else {
                API_PORT.store(2026, Ordering::SeqCst);
                println!(
                    "[API] Dev mode: using external API server on http://localhost:2026 (sidecar disabled)"
                );
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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

/// Check if a port is available
fn is_port_available(port: u16) -> bool {
    use std::net::TcpListener;
    TcpListener::bind(("127.0.0.1", port)).is_ok()
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
