export type SeedConfig = {
  email: string;
  password: string;
  name: string;
  workspaceName: string;
  appSecret: string;
};

type SeedEnvironment = Record<string, string | undefined>;

export function loadSeedConfig(environment: SeedEnvironment = process.env): SeedConfig {
  if (environment.NODE_ENV === "production") {
    throw new Error("Database seeding is disabled in production");
  }
  if (environment.NODE_ENV !== "development") {
    throw new Error("Database seeding requires NODE_ENV=development");
  }

  const email = requiredTrimmed(environment, "SEED_USER_EMAIL").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("SEED_USER_EMAIL must be a valid email address");
  }

  const password = required(environment, "SEED_USER_PASSWORD");
  if (password.length < 10) {
    throw new Error("SEED_USER_PASSWORD must contain at least 10 characters");
  }
  if (password.length > 200) {
    throw new Error("SEED_USER_PASSWORD must contain at most 200 characters");
  }

  return {
    email,
    password,
    name: optionalLabel(environment.SEED_USER_NAME, "RSS Administrator", "SEED_USER_NAME"),
    workspaceName: optionalLabel(
      environment.SEED_WORKSPACE_NAME,
      "RSS Media Stream",
      "SEED_WORKSPACE_NAME"
    ),
    appSecret: required(environment, "APP_SECRET")
  };
}

export function buildSeedUserUpsertArgs(config: SeedConfig, passwordHash: string) {
  return {
    where: { email: config.email },
    create: {
      email: config.email,
      name: config.name,
      passwordHash
    },
    update: {},
    select: { id: true }
  };
}

function required(environment: SeedEnvironment, name: string) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredTrimmed(environment: SeedEnvironment, name: string) {
  const value = required(environment, name).trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalLabel(value: string | undefined, fallback: string, name: string) {
  const normalized = value?.trim() || fallback;
  if (normalized.length > 120) throw new Error(`${name} must contain at most 120 characters`);
  return normalized;
}
