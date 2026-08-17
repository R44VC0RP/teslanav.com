import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import Database from "better-sqlite3";

const databasePath = resolve(
  process.env.TESLANAV_DATABASE_PATH ?? "./data/teslanav.sqlite"
);

mkdirSync(dirname(databasePath), { recursive: true });

export const database = new Database(databasePath);
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");
database.pragma("busy_timeout = 5000");

database.exec(`
  CREATE TABLE IF NOT EXISTS tesla_account (
    user_id TEXT PRIMARY KEY,
    tesla_user_id TEXT NOT NULL UNIQUE,
    email TEXT,
    region TEXT NOT NULL DEFAULT 'na',
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    access_token_expires_at INTEGER NOT NULL,
    vehicles_json TEXT NOT NULL DEFAULT '[]',
    selected_vin TEXT,
    telemetry_configured_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS device_link (
    id TEXT PRIMARY KEY,
    phone_token_hash TEXT NOT NULL,
    car_token_hash TEXT NOT NULL,
    confirmation_code TEXT NOT NULL,
    status TEXT NOT NULL,
    user_id TEXT,
    selected_vin TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS device_link_expires_at_idx
    ON device_link(expires_at);

  CREATE TABLE IF NOT EXISTS tesla_oauth_state (
    state_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    link_id TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS car_session (
    token_hash TEXT PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    selected_vin TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS car_session_expires_at_idx
    ON car_session(expires_at);

  CREATE INDEX IF NOT EXISTS car_session_user_id_idx
    ON car_session(user_id);

  CREATE TABLE IF NOT EXISTS billing_entitlement (
    user_id TEXT NOT NULL,
    feature_id TEXT NOT NULL,
    allowed INTEGER NOT NULL,
    checked_at TEXT NOT NULL,
    PRIMARY KEY (user_id, feature_id),
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
  );
`);

const now = new Date().toISOString();
database.prepare("DELETE FROM device_link WHERE expires_at <= ?").run(now);
database.prepare("DELETE FROM tesla_oauth_state WHERE expires_at <= ?").run(now);
database.prepare("DELETE FROM car_session WHERE expires_at <= ?").run(now);
