use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::str::FromStr;

use super::errors::DbInitError;

struct Migration {
    version: i64,
    name: &'static str,
}

const MIGRATIONS: [Migration; 7] = [
    Migration {
        version: 1,
        name: "initial-schema",
    },
    Migration {
        version: 2,
        name: "task-columns",
    },
    Migration {
        version: 3,
        name: "message-columns",
    },
    Migration {
        version: 4,
        name: "file-columns",
    },
    Migration {
        version: 5,
        name: "task-preview-columns",
    },
    Migration {
        version: 6,
        name: "workspace-schema",
    },
    Migration {
        version: 7,
        name: "drop-vestigial-settings",
    },
];

pub const CURRENT_SCHEMA_VERSION: i64 = MIGRATIONS.len() as i64;

pub async fn initialize_database(database_url: &str) -> Result<SqlitePool, DbInitError> {
    let connect_options = SqliteConnectOptions::from_str(database_url)
        .map_err(|error| DbInitError::InvalidConnectionOptions(error.to_string()))?
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connect_options)
        .await?;

    run_migrations(&pool).await?;

    let version = get_current_version(&pool).await?;
    println!("[DB] Schema ready at version {}", version);

    Ok(pool)
}

pub async fn get_current_version(pool: &SqlitePool) -> Result<i64, DbInitError> {
    let exists = sqlx::query_scalar::<_, String>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'"
    )
    .fetch_optional(pool)
    .await?;

    if exists.is_none() {
        return Ok(0);
    }

    let version = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version"
    )
    .fetch_one(pool)
    .await?;

    Ok(version)
}

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), DbInitError> {
    ensure_schema_version_table(pool).await?;

    let current_version = get_current_version(pool).await?;
    if current_version > CURRENT_SCHEMA_VERSION {
        return Err(DbInitError::FutureSchemaVersion {
            current: current_version,
            supported: CURRENT_SCHEMA_VERSION,
        });
    }

    validate_schema_shape(pool, current_version).await?;

    println!(
        "[DB] Current schema version: {} (supported: {})",
        current_version, CURRENT_SCHEMA_VERSION
    );

    for migration in MIGRATIONS.iter().filter(|migration| migration.version > current_version) {
        println!(
            "[DB] Applying migration v{}: {}",
            migration.version, migration.name
        );
        apply_migration(pool, migration.version).await?;
        sqlx::query("INSERT INTO schema_version (version) VALUES ($1)")
            .bind(migration.version)
            .execute(pool)
            .await?;
    }

    Ok(())
}

async fn validate_schema_shape(pool: &SqlitePool, current_version: i64) -> Result<(), DbInitError> {
    if current_version <= 0 {
        return Ok(());
    }

    if current_version >= 1 {
        let mut required_tables = vec![
            "sessions",
            "tasks",
            "messages",
            "files",
            "preview_instances",
        ];
        // settings table was dropped in v7
        if current_version < 7 {
            required_tables.push("settings");
        }
        for table_name in required_tables {
            ensure_table_shape(pool, current_version, table_name, &[]).await?;
        }
    }

    if current_version >= 2 {
        ensure_table_shape(
            pool,
            current_version,
            "tasks",
            &["session_id", "task_index", "title", "phase", "favorite"],
        )
        .await?;
    }

    if current_version >= 3 {
        ensure_table_shape(
            pool,
            current_version,
            "messages",
            &["role", "tool_use_id", "error_message", "attachments"],
        )
        .await?;
    }

    if current_version >= 4 {
        ensure_table_shape(
            pool,
            current_version,
            "files",
            &[
                "preview",
                "thumbnail",
                "is_favorite",
                "artifact_type",
                "file_size",
                "preview_data",
            ],
        )
        .await?;
    }

    if current_version >= 5 {
        ensure_table_shape(
            pool,
            current_version,
            "tasks",
            &["selected_artifact_id", "preview_mode", "is_right_sidebar_visible"],
        )
        .await?;
    }

    if current_version >= 6 {
        ensure_table_shape(pool, current_version, "workspaces", &["name", "default_work_dir"]).await?;
        ensure_table_shape(pool, current_version, "sessions", &["workspace_id"]).await?;
    }

    Ok(())
}

async fn ensure_schema_version_table(pool: &SqlitePool) -> Result<(), DbInitError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn apply_migration(pool: &SqlitePool, version: i64) -> Result<(), DbInitError> {
    match version {
        1 => apply_initial_schema(pool).await,
        2 => apply_task_columns(pool).await,
        3 => apply_message_columns(pool).await,
        4 => apply_file_columns(pool).await,
        5 => apply_task_preview_columns(pool).await,
        6 => apply_workspace_schema(pool).await,
        7 => apply_drop_vestigial_settings(pool).await,
        _ => Ok(()),
    }
}

async fn apply_initial_schema(pool: &SqlitePool) -> Result<(), DbInitError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            prompt TEXT NOT NULL,
            task_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
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
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
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
            attachments TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            path TEXT NOT NULL,
            preview TEXT,
            thumbnail TEXT,
            is_favorite INTEGER DEFAULT 0,
            artifact_type TEXT,
            file_size INTEGER,
            preview_data TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT (datetime('now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS preview_instances (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            port INTEGER NOT NULL,
            status TEXT DEFAULT 'starting',
            url TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            last_accessed TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await?;

    create_indexes(pool).await
}

async fn apply_task_columns(pool: &SqlitePool) -> Result<(), DbInitError> {
    ensure_column(pool, "tasks", "session_id", "TEXT").await?;
    ensure_column(pool, "tasks", "task_index", "INTEGER").await?;
    ensure_column(pool, "tasks", "title", "TEXT").await?;
    ensure_column(pool, "tasks", "phase", "TEXT DEFAULT 'idle'").await?;
    ensure_column(pool, "tasks", "favorite", "INTEGER DEFAULT 0").await?;

    Ok(())
}

async fn apply_message_columns(pool: &SqlitePool) -> Result<(), DbInitError> {
    ensure_column(pool, "messages", "role", "TEXT").await?;
    ensure_column(pool, "messages", "tool_use_id", "TEXT").await?;
    ensure_column(pool, "messages", "error_message", "TEXT").await?;
    ensure_column(pool, "messages", "attachments", "TEXT").await?;

    Ok(())
}

async fn apply_file_columns(pool: &SqlitePool) -> Result<(), DbInitError> {
    ensure_column(pool, "files", "preview", "TEXT").await?;
    ensure_column(pool, "files", "thumbnail", "TEXT").await?;
    ensure_column(pool, "files", "is_favorite", "INTEGER DEFAULT 0").await?;
    ensure_column(pool, "files", "artifact_type", "TEXT").await?;
    ensure_column(pool, "files", "file_size", "INTEGER").await?;
    ensure_column(pool, "files", "preview_data", "TEXT").await?;

    if column_exists(pool, "files", "preview").await? && column_exists(pool, "files", "preview_data").await? {
        sqlx::query(
            "UPDATE files SET preview = preview_data WHERE preview IS NULL AND preview_data IS NOT NULL"
        )
        .execute(pool)
        .await?;
    }

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_files_artifact_type ON files(artifact_type)")
        .execute(pool)
        .await?;

    Ok(())
}

async fn apply_task_preview_columns(pool: &SqlitePool) -> Result<(), DbInitError> {
    ensure_column(pool, "tasks", "selected_artifact_id", "TEXT").await?;
    ensure_column(pool, "tasks", "preview_mode", "TEXT DEFAULT 'static'").await?;
    ensure_column(pool, "tasks", "is_right_sidebar_visible", "INTEGER DEFAULT 0").await?;

    Ok(())
}

async fn apply_workspace_schema(pool: &SqlitePool) -> Result<(), DbInitError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            default_work_dir TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    ensure_column(pool, "sessions", "workspace_id", "TEXT").await?;

    maybe_create_index(pool, "idx_sessions_workspace_id", "sessions", "workspace_id").await?;

    Ok(())
}

/// Drop the vestigial `settings` table — all settings are now persisted
/// in the file-based settings.json managed by the API sidecar.
async fn apply_drop_vestigial_settings(pool: &SqlitePool) -> Result<(), DbInitError> {
    sqlx::query("DROP TABLE IF EXISTS settings")
        .execute(pool)
        .await?;

    Ok(())
}

async fn create_indexes(pool: &SqlitePool) -> Result<(), DbInitError> {
    maybe_create_index(pool, "idx_tasks_session_id", "tasks", "session_id").await?;
    maybe_create_index(pool, "idx_messages_task_id", "messages", "task_id").await?;
    maybe_create_index(pool, "idx_files_task_id", "files", "task_id").await?;
    maybe_create_index(pool, "idx_preview_instances_task_id", "preview_instances", "task_id").await?;
    maybe_create_index(pool, "idx_files_artifact_type", "files", "artifact_type").await?;

    Ok(())
}

async fn maybe_create_index(
    pool: &SqlitePool,
    index_name: &str,
    table_name: &str,
    column_name: &str,
) -> Result<(), DbInitError> {
    if !column_exists(pool, table_name, column_name).await? {
        return Ok(());
    }

    let sql = format!(
        "CREATE INDEX IF NOT EXISTS {} ON {}({})",
        index_name, table_name, column_name
    );
    sqlx::query(&sql).execute(pool).await?;

    Ok(())
}

async fn ensure_table_shape(
    pool: &SqlitePool,
    current_version: i64,
    table_name: &str,
    required_columns: &[&str],
) -> Result<(), DbInitError> {
    if !table_exists(pool, table_name).await? {
        return Err(DbInitError::SchemaValidation {
            message: format!(
                "database schema version {} is missing required table '{}'",
                current_version, table_name
            ),
        });
    }

    for column_name in required_columns {
        if !column_exists(pool, table_name, column_name).await? {
            return Err(DbInitError::SchemaValidation {
                message: format!(
                    "database schema version {} is missing required column '{}.{}'",
                    current_version, table_name, column_name
                ),
            });
        }
    }

    Ok(())
}

async fn ensure_column(
    pool: &SqlitePool,
    table_name: &str,
    column_name: &str,
    definition: &str,
) -> Result<(), DbInitError> {
    if column_exists(pool, table_name, column_name).await? {
        return Ok(());
    }

    let sql = format!(
        "ALTER TABLE {} ADD COLUMN {} {}",
        table_name, column_name, definition
    );
    sqlx::query(&sql).execute(pool).await?;

    Ok(())
}

async fn column_exists(
    pool: &SqlitePool,
    table_name: &str,
    column_name: &str,
) -> Result<bool, DbInitError> {
    let pragma = format!("PRAGMA table_info({})", table_name);
    let rows = sqlx::query(&pragma).fetch_all(pool).await?;

    Ok(rows.into_iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == column_name)
            .unwrap_or(false)
    }))
}

async fn table_exists(pool: &SqlitePool, table_name: &str) -> Result<bool, DbInitError> {
    let exists = sqlx::query_scalar::<_, String>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = $1"
    )
    .bind(table_name)
    .fetch_optional(pool)
    .await?;

    Ok(exists.is_some())
}

#[cfg(test)]
mod tests {
    use super::{
        get_current_version,
        initialize_database,
        run_migrations,
        CURRENT_SCHEMA_VERSION,
    };
    use crate::db::errors::DbInitError;
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::Row;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn fresh_database_bootstraps_to_current_version() {
        tauri::async_runtime::block_on(async {
            let db_path = test_db_path("fresh-bootstrap");
            let database_url = sqlite_url(&db_path);

            let pool = initialize_database(&database_url)
                .await
                .expect("fresh database should initialize");

            let version = get_current_version(&pool)
                .await
                .expect("fresh database should report schema version");
            assert_eq!(version, CURRENT_SCHEMA_VERSION);

            let task_columns = table_columns(&pool, "tasks").await;
            assert!(task_columns.contains(&"favorite".to_string()));
            assert!(task_columns.contains(&"title".to_string()));
            assert!(task_columns.contains(&"selected_artifact_id".to_string()));
            assert!(task_columns.contains(&"preview_mode".to_string()));
            assert!(task_columns.contains(&"is_right_sidebar_visible".to_string()));

            let message_columns = table_columns(&pool, "messages").await;
            assert!(message_columns.contains(&"role".to_string()));
            assert!(message_columns.contains(&"tool_use_id".to_string()));
            assert!(message_columns.contains(&"error_message".to_string()));
            assert!(message_columns.contains(&"attachments".to_string()));

            let file_columns = table_columns(&pool, "files").await;
            assert!(file_columns.contains(&"preview".to_string()));
            assert!(file_columns.contains(&"thumbnail".to_string()));
            assert!(file_columns.contains(&"is_favorite".to_string()));

            pool.close().await;
            cleanup_db_file(&db_path);
        });
    }

    #[test]
    fn rerunning_migrations_is_idempotent() {
        tauri::async_runtime::block_on(async {
            let db_path = test_db_path("rerun");
            let database_url = sqlite_url(&db_path);

            let pool = initialize_database(&database_url)
                .await
                .expect("database should initialize");
            run_migrations(&pool)
                .await
                .expect("rerunning migrations should succeed");

            let version = get_current_version(&pool)
                .await
                .expect("database should report schema version after rerun");
            assert_eq!(version, CURRENT_SCHEMA_VERSION);

            let applied_versions = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM schema_version"
            )
            .fetch_one(&pool)
            .await
            .expect("schema_version count should be queryable");

            assert_eq!(applied_versions, CURRENT_SCHEMA_VERSION);

            pool.close().await;
            cleanup_db_file(&db_path);
        });
    }

    #[test]
    fn future_schema_version_fails() {
        tauri::async_runtime::block_on(async {
            let db_path = test_db_path("future-version");
            let database_url = sqlite_url(&db_path);

            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect(&database_url)
                .await
                .expect("test pool should connect");

            sqlx::query(
                r#"
                CREATE TABLE schema_version (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
                "#,
            )
            .execute(&pool)
            .await
            .expect("schema_version table should be created");

            sqlx::query("INSERT INTO schema_version (version) VALUES ($1)")
                .bind(CURRENT_SCHEMA_VERSION + 1)
                .execute(&pool)
                .await
                .expect("future schema version should be inserted");

            let error = run_migrations(&pool)
                .await
                .expect_err("future schema should fail");

            assert!(matches!(
                error,
                DbInitError::FutureSchemaVersion { current, supported }
                    if current == CURRENT_SCHEMA_VERSION + 1 && supported == CURRENT_SCHEMA_VERSION
            ));

            pool.close().await;
            cleanup_db_file(&db_path);
        });
    }

    #[test]
    fn current_version_requires_expected_schema_shape() {
        tauri::async_runtime::block_on(async {
            let db_path = test_db_path("current-version-shape");
            let database_url = sqlite_url(&db_path);

            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect(&database_url)
                .await
                .expect("test pool should connect");

            sqlx::query(
                r#"
                CREATE TABLE schema_version (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
                "#,
            )
            .execute(&pool)
            .await
            .expect("schema_version table should be created");

            sqlx::query(
                r#"
                CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    prompt TEXT NOT NULL,
                    status TEXT DEFAULT 'running',
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT DEFAULT (datetime('now'))
                )
                "#,
            )
            .execute(&pool)
            .await
            .expect("legacy-shaped tasks table should be created");

            sqlx::query("INSERT INTO schema_version (version) VALUES ($1)")
                .bind(CURRENT_SCHEMA_VERSION)
                .execute(&pool)
                .await
                .expect("current schema version should be inserted");

            let error = run_migrations(&pool)
                .await
                .expect_err("shape validation should fail");

            assert!(matches!(error, DbInitError::SchemaValidation { .. }));

            pool.close().await;
            cleanup_db_file(&db_path);
        });
    }

    #[test]
    fn legacy_database_upgrades_and_preserves_preview_data() {
        tauri::async_runtime::block_on(async {
            let db_path = test_db_path("legacy-upgrade");
            let database_url = sqlite_url(&db_path);

            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect(&database_url)
                .await
                .expect("legacy test pool should connect");

            sqlx::query(
                r#"
                CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    prompt TEXT NOT NULL,
                    status TEXT DEFAULT 'running',
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT DEFAULT (datetime('now'))
                )
                "#,
            )
            .execute(&pool)
            .await
            .expect("legacy tasks table should be created");

            sqlx::query(
                r#"
                CREATE TABLE messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    content TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                )
                "#,
            )
            .execute(&pool)
            .await
            .expect("legacy messages table should be created");

            sqlx::query(
                r#"
                CREATE TABLE files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    path TEXT NOT NULL,
                    preview_data TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                )
                "#,
            )
            .execute(&pool)
            .await
            .expect("legacy files table should be created");

            sqlx::query(
                "INSERT INTO files (task_id, name, type, path, preview_data) VALUES ($1, $2, $3, $4, $5)"
            )
            .bind("task_legacy")
            .bind("artifact.md")
            .bind("text")
            .bind("/tmp/artifact.md")
            .bind("legacy-preview")
            .execute(&pool)
            .await
            .expect("legacy file row should be inserted");

            run_migrations(&pool)
                .await
                .expect("legacy database should migrate");

            let version = get_current_version(&pool)
                .await
                .expect("legacy database should report current version");
            assert_eq!(version, CURRENT_SCHEMA_VERSION);

            let task_columns = table_columns(&pool, "tasks").await;
            assert!(task_columns.contains(&"session_id".to_string()));
            assert!(task_columns.contains(&"favorite".to_string()));
            assert!(task_columns.contains(&"preview_mode".to_string()));

            let message_columns = table_columns(&pool, "messages").await;
            assert!(message_columns.contains(&"attachments".to_string()));
            assert!(message_columns.contains(&"role".to_string()));

            let file_columns = table_columns(&pool, "files").await;
            assert!(file_columns.contains(&"preview".to_string()));
            assert!(file_columns.contains(&"is_favorite".to_string()));

            let preview = sqlx::query_scalar::<_, Option<String>>(
                "SELECT preview FROM files WHERE task_id = $1"
            )
            .bind("task_legacy")
            .fetch_one(&pool)
            .await
            .expect("migrated preview should be queryable");
            assert_eq!(preview.as_deref(), Some("legacy-preview"));

            pool.close().await;
            cleanup_db_file(&db_path);
        });
    }

    async fn table_columns(pool: &sqlx::SqlitePool, table_name: &str) -> Vec<String> {
        let pragma = format!("PRAGMA table_info({})", table_name);
        sqlx::query(&pragma)
            .fetch_all(pool)
            .await
            .expect("table_info should be queryable")
            .into_iter()
            .filter_map(|row| row.try_get::<String, _>("name").ok())
            .collect()
    }

    fn test_db_path(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "arclay-migrations-{}-{}-{}.db",
            name,
            std::process::id(),
            suffix
        ))
    }

    fn sqlite_url(path: &Path) -> String {
        format!("sqlite:{}?mode=rwc", path.display())
    }

    fn cleanup_db_file(path: &Path) {
        let _ = std::fs::remove_file(path);
    }
}
