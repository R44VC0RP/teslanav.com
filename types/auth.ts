export type AuthProvider = "email" | "google" | "apple";

export interface User {
  id: string;
  email: string;
  provider: AuthProvider;
  providerId?: string; // For OAuth providers
  name?: string;
  createdAt: number;
  lastLoginAt?: number;
  avatar?: string;
}

export interface Session {
  userId: string;
  token: string;
  expiresAt: number;
}

export interface AuthResponse {
  success: boolean;
  user?: User;
  token?: string;
  message?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
}

export interface OAuthCallbackRequest {
  code: string;
  state: string;
  redirectUri: string;
}
