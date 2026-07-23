import { parse, type Type } from "protobufjs";

// Minimal read-only schema for Waze's mobile RT protocol. Field numbers and
// wire types are adapted from the MIT-licensed highway-radar-sabre-plus
// reconstruction (https://github.com/nicglazkov/highway-radar-sabre-plus).
// Fields not needed for register/login/alert reads are intentionally omitted;
// proto2 decoders safely skip them.
const PROTO = String.raw`
syntax = "proto2";

message Batch {
  repeated Element element = 1001;
  optional int64 expiration_gmt = 1002;
}

message Element {
  optional int32 request_id = 1;
  optional string old_command = 2001;
  optional ServerError error = 2003;
  optional ReportAdsSettings report_ads_setting = 2108;
  optional ClientInfo client_info = 2184;
  optional Register register = 2219;
  optional RegisterSuccessful register_successful = 2220;
  optional UID uid = 2221;
  optional LoginError login_error = 2224;
  optional AddAlertAction add_alert_action = 2708;
  optional LoginRequest login_request = 2744;
  optional LoginResponse login_response = 2745;
}

message StringEntry { optional string key = 1; optional string value = 2; }
message StringMap { repeated StringEntry entry = 1; }

message Coordinate {
  optional int32 lon_times1000000 = 101;
  optional int32 lat_times1000000 = 102;
}

enum DeviceType { UNKNOWN_DEVICE_TYPE = 0; ANDROID_DEVICE = 50; WEB = 100; }
enum AppType { UNKNOWN_APP_TYPE = 0; WAZE = 1; WEB_CLIENT = 7; }
enum AppFlavor {
  UNKNOWN_APP_FLAVOR = 0; RELEASE = 1; FISHFOOD = 2; DOGFOOD = 3;
  PRE_BETA = 4; ALPHA = 5; DEV = 6; ONEOFF = 7; BETA = 8;
}
enum SegmentDirection {
  SEGMENT_DIRECTION_UNSPECIFIED = 0;
  SEGMENT_DIRECTION_FORWARD = 1;
  SEGMENT_DIRECTION_BACKWARD = 2;
  SEGMENT_DIRECTION_BOTH = 3;
}

enum AlertType {
  UNKNOWN_TYPE = 0; CHIT_CHAT = 1; POLICE = 2; ACCIDENT = 3; JAM = 4;
  TRAFFIC_INFO = 5; HAZARD = 6; MISC = 7; CONSTRUCTION = 8; PARKING = 9;
  DYNAMIC = 10; CAMERA = 11; PARKED_UNUSED = 12; ROAD_CLOSED = 13;
  SYSTEM_ROAD_CLOSED = 14; UNKNOWN_ALERT = 15; SOS = 16; CRASH_PRONE = 17;
  TURN_CLOSED = 19; NEW_BAD_WEATHER = 100; NEW_LANE_CLOSED = 101;
  PERMANENT_HAZARD = 103; PERSONAL_SAFETY = 104;
}

enum AlertSubType {
  NO_SUBTYPE = 0;
  POLICE_VISIBLE = 201; POLICE_HIDING = 202; POLICE_WITH_MOBILE_CAMERA = 203;
  ACCIDENT_MINOR = 301; ACCIDENT_MAJOR = 302;
  JAM_MODERATE_TRAFFIC = 401; JAM_HEAVY_TRAFFIC = 402;
  JAM_STAND_STILL_TRAFFIC = 403; JAM_LIGHT_TRAFFIC = 404;
  HAZARD_ON_ROAD = 601; HAZARD_ON_SHOULDER = 602; HAZARD_WEATHER = 603;
  HAZARD_ON_ROAD_OBJECT = 604; HAZARD_ON_ROAD_POT_HOLE = 605;
  HAZARD_ON_ROAD_ROAD_KILL = 606; HAZARD_ON_SHOULDER_CAR_STOPPED = 607;
  HAZARD_ON_SHOULDER_ANIMALS = 608; HAZARD_ON_SHOULDER_MISSING_SIGN = 609;
  HAZARD_WEATHER_FOG = 610; HAZARD_WEATHER_HAIL = 611;
  HAZARD_WEATHER_HEAVY_RAIN = 612; HAZARD_WEATHER_HEAVY_SNOW = 613;
  HAZARD_WEATHER_FLOOD = 614; HAZARD_WEATHER_MONSOON = 615;
  HAZARD_WEATHER_TORNADO = 616; HAZARD_WEATHER_HEAT_WAVE = 617;
  HAZARD_WEATHER_HURRICANE = 618; HAZARD_WEATHER_FREEZING_RAIN = 619;
  HAZARD_ON_ROAD_LANE_CLOSED = 620; HAZARD_ON_ROAD_OIL = 621;
  HAZARD_ON_ROAD_ICE = 622; HAZARD_ON_ROAD_CONSTRUCTION = 623;
  HAZARD_ON_ROAD_CAR_STOPPED = 624;
  HAZARD_ON_ROAD_TRAFFIC_LIGHT_FAULT = 625;
  HAZARD_ON_ROAD_EMERGENCY_VEHICLE = 626;
  ROAD_CLOSED_HAZARD = 1301; ROAD_CLOSED_CONSTRUCTION = 1302;
  ROAD_CLOSED_EVENT = 1303;
  SOS_FLAT_TIRE = 1601; SOS_NO_FUEL = 1602; SOS_MEDICAL_HELP = 1603;
  SOS_MECHANICAL_PROBLEM = 1604; SOS_OTHER = 1605; SOS_BATTERY_ISSUE = 1606;
  CRASH_PRONE_SHORT_ALERT_LENGTH = 1701; CRASH_PRONE_LONG_ALERT_LENGTH = 1702;
  TURN_CLOSED_EVENT = 1901;
  BAD_WEATHER_DEFAULT = 2000; BAD_WEATHER_SLIPPERY_ROAD = 2001;
  LANE_CLOSURE_BLOCKED_LANES = 2002; LANE_CLOSURE_LEFT_LANE = 2003;
  LANE_CLOSURE_RIGHT_LANE = 2004; LANE_CLOSURE_CENTER_LANE = 2005;
  PERMANENT_HAZARD_SPEED_BUMP = 3001; PERMANENT_HAZARD_TOPES = 3002;
  PERMANENT_HAZARD_TOLL_BOOTH = 3003;
  PERMANENT_HAZARD_DANGEROUS_CURVE = 3004;
  PERMANENT_HAZARD_DANGEROUS_INTERSECTION = 3005;
  PERMANENT_HAZARD_DANGEROUS_SPLIT = 3006;
  PERMANENT_HAZARD_DANGEROUS_MERGE = 3007;
  PERMANENT_HAZARD_SCHOOL_ZONE = 3008;
  DEFAULT_PERSONAL_SAFETY = 4001; DEFAULT_CAMERA = 5001;
}

message ClientInfo {
  enum Environment { STAGING = 1; AUTOPUSH = 2; PRODUCTION = 3; }
  optional int32 protocol = 1;
  optional string client_version = 3;
  optional Coordinate last_position = 4;
  optional string manufacturer = 5;
  optional string model = 6;
  optional string os_version = 11;
  optional StringMap client_ab_tests = 13;
  optional string locale = 16;
  optional string installation_id = 17;
  optional DeviceType device_type = 18;
  optional AppType app_type = 19;
  optional Environment environment = 21;
  optional StringMap debug_options = 22;
  repeated Display display = 24;
  optional string os_language_id = 25;
  optional string session_uuid = 26;
  optional int64 current_time_millis = 28;
  optional string device_brand = 29;
  optional AppFlavor app_flavor = 31;
}

message Display {
  enum Type { UNKNOWN = 1; BUILT_IN = 2; CARPLAY = 3; ANDROID_AUTO = 4; }
  optional Type type = 1;
  optional int32 width = 2;
  optional int32 height = 3;
}

message ReportAdsSettings {
  optional string advertising_id = 1;
  optional bool opted_out_of_tracking = 2;
}

message Register { optional string code = 1; }
message RegisterSuccessful {
  optional string username = 1;
  optional string password = 2;
  optional string token = 3;
  optional int64 user_id = 4;
}

message PasswordCredential { optional string username = 1; optional string password = 2; }
message LoginRequest {
  enum LoginReason { NORMAL = 0; SIGN_IN = 1; }
  optional PasswordCredential password_credential = 1;
  optional LoginReason reason = 3;
  optional bool logout_other_devices = 4 [default = true];
}
message LoginSuccess {
  optional int64 server_session_id = 1;
  optional string global_user_id = 2;
  optional string secret_key = 3;
  optional string session_id = 4;
}
message LoginError {
  enum AuthErrorType {
    UNKNOWN_ERROR = 0; WRONG_USER_PASSWORD = 1; INTERNAL_ISSUES = 2;
    NOT_AUTHORIZED = 3; REFRESH_TOKEN = 4; ANOTHER_DEVICE_LOGGED_IN = 5;
    INVALID_TOKEN = 6; UNAUTHENTICATED_TOKEN = 7;
    TOKEN_QUOTA_EXCEEDED = 8; APP_VERSION_NOT_SUPPORTED = 9;
  }
  optional int64 reason = 1;
  optional AuthErrorType error_type = 2;
}
message LoginResponse { optional LoginSuccess login_success = 1; optional LoginError login_error = 2; }
message UID { optional int64 id = 1; optional string secret_key = 2; optional int32 protocol = 3; }

message AddAlertAction { optional RealtimeAlert realtime_alert = 1; }
message RealtimeAlert {
  optional int64 id = 1;
  optional AlertInfo alert_info = 2;
  optional AlertReportingInfo alert_reporting_info = 3;
  optional bool notify_alerter_shown = 5;
  optional string alert_uuid = 6;
  optional string alerter_shown_token = 7;
}
message AlertInfo {
  optional AlertType type = 1;
  optional AlertSubType sub_type = 2;
  optional Coordinate position = 3;
  optional SegmentDirection seg_direction = 5;
  optional int32 azymuth = 6;
  optional bool on_route = 7;
  optional int32 priority = 8;
}
message AlertReportingInfo {
  optional int64 primary_alert_id = 1;
  optional string description = 3;
  optional int64 report_time = 4;
  optional string reporter_username = 5;
  optional AlertAddress alert_address = 8;
  optional int32 thumbs_up_count = 9;
}
message AlertAddress {
  optional string location_near_by_report = 1;
  optional string street = 2;
  optional string city = 3;
}
message ServerError {
  optional int32 code = 10101;
  optional string description = 10102;
}
`;

const root = parse(PROTO, { keepCase: true }).root;

export const WazeTypes = {
  Batch: root.lookupType("Batch"),
  Element: root.lookupType("Element"),
  UID: root.lookupType("UID"),
} satisfies Record<string, Type>;

export function encodeWaze(type: Type, value: Record<string, unknown>): Uint8Array {
  return type.encode(type.create(value)).finish();
}

export function decodeWaze(type: Type, bytes: Uint8Array): Record<string, unknown> {
  return type.toObject(type.decode(bytes), {
    longs: String,
    enums: String,
    defaults: false,
    arrays: true,
  }) as Record<string, unknown>;
}
