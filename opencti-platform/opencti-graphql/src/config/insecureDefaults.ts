// Known insecure default secrets that were shipped as fallback values in
// docker-compose.yml / .env.sample. Deploying with any of these means the
// secret is publicly known (it is in the repository and its git history),
// so the platform must refuse to start until a real value is configured.

// Base64 of "thisisATestKeyForDevOnly12345678"
export const INSECURE_DEFAULT_ENCRYPTION_KEY = 'dGhpcklzQVRlc3RLZXlGb3JEZXZPbmx5MTIzNDU2Nzg=';
export const INSECURE_DEFAULT_ADMIN_TOKEN = 'b1976749-8a53-4c49-a8c2-47d7d52e3f9a';
export const INSECURE_DEFAULT_ADMIN_PASSWORD = 'ChangeMePlease';
export const INSECURE_DEFAULT_HEALTH_ACCESS_KEY = 'healthcheck-key';

export const REMEDIATION_HINT = "Generate a unique value (e.g. 'openssl rand -base64 32' for keys, "
  + "'uuidgen' for the admin token) and set it in your .env file. Never deploy with the example defaults.";
