#[derive(Debug)]
pub enum DbInitError {
    FutureSchemaVersion { current: i64, supported: i64 },
    SchemaValidation { message: String },
    Sqlx(sqlx::Error),
    InvalidConnectionOptions(String),
}

impl std::fmt::Display for DbInitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FutureSchemaVersion { current, supported } => {
                write!(
                    f,
                    "database schema version {} is newer than supported version {}",
                    current, supported
                )
            }
            Self::SchemaValidation { message } => write!(f, "{}", message),
            Self::Sqlx(error) => write!(f, "{}", error),
            Self::InvalidConnectionOptions(error) => write!(f, "{}", error),
        }
    }
}

impl std::error::Error for DbInitError {}

impl From<sqlx::Error> for DbInitError {
    fn from(value: sqlx::Error) -> Self {
        Self::Sqlx(value)
    }
}
