use serde_json::Value;
use sqlx::{Row, Column};
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::OnceLock;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

// Global variable to store the API port (0 means not ready yet)
static API_PORT: AtomicU16 = AtomicU16::new(0);

// Global database pool
static DB_POOL: OnceLock<SqlitePool> = OnceLock::new();

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
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            // Initialize database pool
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = init_database(&app_handle).await {
                    eprintln!("[DB] Failed to initialize database: {}", e);
                }
            });

            let spawn_sidecar_in_dev = std::env::var("EASYWORK_SPAWN_SIDECAR_IN_DEV")
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false);
            let should_spawn_sidecar = !cfg!(debug_assertions) || spawn_sidecar_in_dev;

            if should_spawn_sidecar {
                // Spawn API sidecar
                let shell = app.shell();
                let sidecar_command = shell.sidecar("easywork-api").unwrap();

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

    let app_data_dir = app.path().resolve("easywork.db", BaseDirectory::AppData)?;
    let db_path = app_data_dir.to_string_lossy().to_string();

    // Ensure parent directory exists
    if let Some(parent) = app_data_dir.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let database_url = format!("sqlite:{}?mode=rwc", db_path);
    println!("[DB] Connecting to: {}", database_url);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    // Enable WAL mode
    sqlx::query("PRAGMA journal_mode = WAL")
        .execute(&pool)
        .await?;

    // Initialize schema
    init_schema(&pool).await?;

    // Store pool globally
    DB_POOL.set(pool).map_err(|_| "Database pool already initialized")?;

    println!("[DB] Database initialized successfully");
    Ok(())
}

/// Initialize database schema
async fn init_schema(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            prompt TEXT NOT NULL,
            task_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            task_index INTEGER,
            prompt TEXT NOT NULL,
            title TEXT,
            status TEXT DEFAULT 'running',
            phase TEXT DEFAULT 'idle',
            cost REAL,
            duration INTEGER,
            favorite INTEGER DEFAULT 0,
            selected_artifact_id TEXT,
            preview_mode TEXT DEFAULT 'static',
            is_right_sidebar_visible INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            type TEXT NOT NULL,
            role TEXT,
            content TEXT,
            tool_name TEXT,
            tool_input TEXT,
            tool_output TEXT,
            tool_use_id TEXT,
            error_message TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            path TEXT NOT NULL,
            artifact_type TEXT,
            file_size INTEGER,
            preview_data TEXT,
            thumbnail TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS preview_instances (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            port INTEGER NOT NULL,
            status TEXT DEFAULT 'starting',
            url TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            last_accessed TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
        CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id);
        CREATE INDEX IF NOT EXISTS idx_files_task_id ON files(task_id);
        CREATE INDEX IF NOT EXISTS idx_preview_instances_task_id ON preview_instances(task_id);
        CREATE INDEX IF NOT EXISTS idx_files_artifact_type ON files(artifact_type);
        "#,
    )
    .execute(pool)
    .await?;

    // 迁移：为现有的 tasks 表添加 title 列（如果不存在）
    sqlx::query("ALTER TABLE tasks ADD COLUMN title TEXT")
        .execute(pool)
        .await
        .ok(); // 忽略错误，因为列可能已经存在

    // 迁移：为现有的 files 表添加新列（如果不存在）
    sqlx::query("ALTER TABLE files ADD COLUMN artifact_type TEXT")
        .execute(pool)
        .await
        .ok();
    
    sqlx::query("ALTER TABLE files ADD COLUMN file_size INTEGER")
        .execute(pool)
        .await
        .ok();
    
    sqlx::query("ALTER TABLE files ADD COLUMN preview_data TEXT")
        .execute(pool)
        .await
        .ok();
    
    sqlx::query("ALTER TABLE files ADD COLUMN thumbnail TEXT")
        .execute(pool)
        .await
        .ok();

    // 迁移：为现有的 tasks 表添加 UI 状态列（如果不存在）
    sqlx::query("ALTER TABLE tasks ADD COLUMN selected_artifact_id TEXT")
        .execute(pool)
        .await
        .ok();

    sqlx::query("ALTER TABLE tasks ADD COLUMN preview_mode TEXT DEFAULT 'static'")
        .execute(pool)
        .await
        .ok();

    sqlx::query("ALTER TABLE tasks ADD COLUMN is_right_sidebar_visible INTEGER DEFAULT 0")
        .execute(pool)
        .await
        .ok();

    // 迁移：为现有的 messages 表添加新列（如果不存在）
    sqlx::query("ALTER TABLE messages ADD COLUMN role TEXT")
        .execute(pool)
        .await
        .ok();

    sqlx::query("ALTER TABLE messages ADD COLUMN tool_use_id TEXT")
        .execute(pool)
        .await
        .ok();

    sqlx::query("ALTER TABLE messages ADD COLUMN error_message TEXT")
        .execute(pool)
        .await
        .ok();

    Ok(())
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
