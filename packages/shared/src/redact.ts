const SECRET_QUERY_KEYS = [
  "passkey",
  "token",
  "apikey",
  "api_key",
  "auth",
  "key",
  "password",
  "pwd"
];

export function redactSecrets(input: string): string {
  let output = input;
  for (const key of SECRET_QUERY_KEYS) {
    output = output.replace(
      new RegExp(`([?&]${key}=)[^&#"'\\\\\\s]+`, "gi"),
      `$1[REDACTED]`
    );
  }
  output = output.replace(/(passkey[/:_-])[a-z0-9]{8,}/gi, "$1[REDACTED]");
  return output;
}
