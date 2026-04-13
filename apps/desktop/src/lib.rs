mod db;

use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePool;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::sync::Notify;
#[cfg(debug_assertions)]
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

const DEFAULT_API_PORT: u16 = 2026;
const DESKTOP_SIDECAR_PROTOCOL: u16 = 1;
const SIDECAR_RESTART_DELAY_SECS: u64 = 2;
const SIDECAR_MAX_RESTART_ATTEMPTS: u32 = 3;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiHealthResponse {
    status: String,
    desktop_sidecar_protocol: Option<u16>,
}

/// Payload emitted to the frontend via the `sidecar-status` Tauri event.
#[derive(Clone, Serialize)]
#[serde(tag = "type", content = "data")]
enum SidecarStatus {
    Ready,
    Crashed { exit_code: Option<i32> },
    Restarting { attempt: u32 },
    Restarted,
    RestartFailed { reason: String },
}

// Global variable to store the API port
static API_PORT: AtomicU16 = AtomicU16::new(2026);

// Global database pool
static DB_POOL: OnceLock<SqlitePool> = OnceLock::new();

// Database initialization notifier
static DB_READY: OnceLock<Arc<Notify>> = OnceLock::new();

// Database initialization error, if startup migration failed
static DB_INIT_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();

// Store sidecar child process for cleanup on exit
static SIDECAR_CHILD: OnceLock<Mutex<Option<tauri_plugin_shell::process::CommandChild>>> = OnceLock::new();

// Store app handle globally so spawn_sidecar can be called from the Terminated handler
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

// Flag to distinguish user-initiated shutdown from unexpected crash
static SIDECAR_SHUTDOWN_REQUESTED: AtomicBool = AtomicBool::new(false);

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
            wait_for_db_ready
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

            DB_READY.get_or_init(|| Arc::new(Notify::new()));
            DB_INIT_ERROR.get_or_init(|| Mutex::new(None));

            // Initialize database asynchronously to avoid blocking startup
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match init_database(&app_handle).await {
                    Ok(_) => {
                        println!("[DB] Database initialized successfully");
                        if let Some(error_state) = DB_INIT_ERROR.get() {
                            if let Ok(mut guard) = error_state.lock() {
                                *guard = None;
                            }
                        }
                        // Notify database readiness waiters
                        if let Some(notify) = DB_READY.get() {
                            notify.notify_waiters();
                        }
                    }
                    Err(e) => {
                        let error_message = e.to_string();
                        eprintln!("[DB] Database initialization failed: {}", error_message);
                        if let Some(error_state) = DB_INIT_ERROR.get() {
                            if let Ok(mut guard) = error_state.lock() {
                                *guard = Some(error_message);
                            }
                        }
                        if let Some(notify) = DB_READY.get() {
                            notify.notify_waiters();
                        }
                    }
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

                // Initialize the sidecar child holder and store AppHandle for restarts
                SIDECAR_CHILD.get_or_init(|| Mutex::new(None));
                APP_HANDLE.set(app.handle().clone()).ok();

                // Set environment variable for sidecar detection
                std::env::set_var("TAURI_FAMILY", "sidecar");

                if let Err(e) = spawn_sidecar(app.handle()) {
                    eprintln!("Failed to start API sidecar: {}", e);
                    #[cfg(debug_assertions)]
                    println!("Running in dev mode - API should be started separately with 'pnpm dev:api'");
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
                    SIDECAR_SHUTDOWN_REQUESTED.store(true, Ordering::SeqCst);
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

/// Emit a sidecar-status event to all frontend windows.
fn emit_sidecar_status(status: SidecarStatus) {
    if let Some(handle) = APP_HANDLE.get() {
        use tauri::Emitter;
        if let Err(e) = handle.emit("sidecar-status", &status) {
            eprintln!("[API] Failed to emit sidecar-status event: {}", e);
        }
    }
}

/// Spawn the API sidecar and set up its event handler.
/// Can be called both on initial startup and for restarts.
fn spawn_sidecar(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let shell = app_handle.shell();
    let sidecar_command = shell
        .sidecar("arclay-api")
        .map_err(|e| format!("Failed to prepare sidecar command: {}", e))?;

    let (mut rx, child) = sidecar_command
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    println!("[API] Sidecar started (PID: {:?})", child.pid());

    // Store child in the global holder (replaces previous if any)
    if let Some(mutex) = SIDECAR_CHILD.get() {
        if let Ok(mut guard) = mutex.lock() {
            *guard = Some(child);
        }
    }

    // Handle sidecar output in a background task
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let output = String::from_utf8_lossy(&line);
                    if let Some(port) = parse_api_port_from_sidecar_output(output.as_ref()) {
                        API_PORT.store(port, Ordering::SeqCst);
                        println!("[API] Active API port updated to {}", port);
                        emit_sidecar_status(SidecarStatus::Ready);
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

                    if SIDECAR_SHUTDOWN_REQUESTED.load(Ordering::SeqCst) {
                        return; // User-initiated exit, don't restart
                    }

                    emit_sidecar_status(SidecarStatus::Crashed {
                        exit_code: payload.code,
                    });

                    // Attempt restart with backoff
                    for attempt in 1..=SIDECAR_MAX_RESTART_ATTEMPTS {
                        let delay = Duration::from_secs(SIDECAR_RESTART_DELAY_SECS * attempt as u64);
                        println!("[API] Restart attempt {}/{} in {:?}", attempt, SIDECAR_MAX_RESTART_ATTEMPTS, delay);
                        emit_sidecar_status(SidecarStatus::Restarting { attempt });
                        tokio::time::sleep(delay).await;

                        if SIDECAR_SHUTDOWN_REQUESTED.load(Ordering::SeqCst) {
                            return; // Exit requested during restart wait
                        }

                        if let Some(handle) = APP_HANDLE.get() {
                            match spawn_sidecar(handle) {
                                Ok(_) => {
                                    println!("[API] Sidecar restarted successfully on attempt {}", attempt);
                                    emit_sidecar_status(SidecarStatus::Restarted);
                                    return;
                                }
                                Err(e) => {
                                    eprintln!("[API] Restart attempt {} failed: {}", attempt, e);
                                }
                            }
                        }
                    }

                    let reason = format!("Failed after {} restart attempts", SIDECAR_MAX_RESTART_ATTEMPTS);
                    eprintln!("[API] {}", reason);
                    emit_sidecar_status(SidecarStatus::RestartFailed { reason });
                }
                _ => {}
            }
        }
    });

    Ok(())
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

fn get_database_init_error() -> Option<String> {
    DB_INIT_ERROR.get().and_then(|error_state| {
        error_state
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
    })
}

async fn wait_for_database_ready() -> Result<(), String> {
    if DB_POOL.get().is_some() {
        return Ok(());
    }

    if let Some(error_message) = get_database_init_error() {
        return Err(format!("Database initialization failed: {}", error_message));
    }

    if let Some(notify) = DB_READY.get() {
        notify.notified().await;
    }

    if DB_POOL.get().is_some() {
        return Ok(());
    }

    if let Some(error_message) = get_database_init_error() {
        return Err(format!("Database initialization failed: {}", error_message));
    }

    Err("Database not initialized".to_string())
}

/// Tauri command to wait for database initialization to complete
#[tauri::command]
async fn wait_for_db_ready() -> Result<bool, String> {
    wait_for_database_ready().await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{
        get_database_init_error,
        is_compatible_api_health_response,
        parse_api_port_from_sidecar_output,
        wait_for_database_ready,
        DB_INIT_ERROR,
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

    #[test]
    fn wait_for_database_ready_returns_init_error_without_hanging() {
        let error_state = DB_INIT_ERROR.get_or_init(|| std::sync::Mutex::new(None));
        {
            let mut guard = error_state.lock().expect("db init error mutex should lock");
            *guard = Some("boom".to_string());
        }

        let result = tauri::async_runtime::block_on(wait_for_database_ready());
        assert_eq!(
            result.expect_err("wait should surface init failure"),
            "Database initialization failed: boom"
        );
        assert_eq!(get_database_init_error().as_deref(), Some("boom"));

        let mut guard = error_state.lock().expect("db init error mutex should lock");
        *guard = None;
    }
}
