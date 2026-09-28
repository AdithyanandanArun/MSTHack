// Deterministic static rules. Every fact points to a concrete file and line so
// the agent and human reviewers can check it. Rules only describe what the
// code contains; they never conclude that a release is malicious.
import type { Observation } from "@/lib/canonical";
import type { ArtifactFile, Fact, FactCategory, FactSeverity, ReleaseArtifact } from "./types";

interface LineRule {
  id: string;
  category: FactCategory;
  observation: Observation | null;
  severity: FactSeverity;
  pattern: RegExp;
  describe: (m: RegExpMatchArray) => string;
  /** Skip matches that are clearly harmless (e.g. loopback addresses). */
  ignore?: (m: RegExpMatchArray, line: string) => boolean;
}

// Matches both literal paths ("~/.ssh/id_rsa") and path segments built with
// path.join(os.homedir(), ".ssh", ...), which is how real payloads hide them.
const SENSITIVE =
  /(\.ssh(?=[\/'"`\\])|id_rsa|id_ed25519|id_ecdsa|authorized_keys|known_hosts|\.aws(?=[\/'"`\\])|\.npmrc|\.git-credentials|\.bash_history|\.zsh_history|\/etc\/shadow|\/etc\/passwd|wallet\.dat|\.gnupg|\.docker(?=[\/'"`\\])|\.kube(?=[\/'"`\\])|\.config\/gcloud|Local Storage\/leveldb|keychain|\.netrc|\.pypirc)/;
const SECRET_ENV = /process\.env(?:\.|\[\s*['"`])([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_KEY|ACCESS_KEY|AWS_|NPM_|GITHUB_|GH_|SSH_)[A-Z0-9_]*)/i;

export const JS_RULES: LineRule[] = [
  {
    id: "js.network-module",
    category: "network",
    observation: "NETWORK_EGRESS",
    severity: "low",
    pattern: /(?:require\(\s*|from\s+|import\(\s*)['"`](?:node:)?(https?|net|tls|dgram|dns|http2)['"`]/,
    describe: (m) => `imports the Node '${m[1]}' networking module`,
  },
  {
    id: "js.network-call",
    category: "network",
    observation: "NETWORK_EGRESS",
    severity: "low",
    pattern: /\b(fetch|XMLHttpRequest|WebSocket|axios|got|request)\s*\(|\.request\(\s*\{|new\s+(WebSocket|XMLHttpRequest)\b|\bsocket\.connect\(|\bnet\.connect\(|\bcreateConnection\(/,
    describe: () => "performs a network request / connection",
  },
  {
    id: "js.hardcoded-endpoint",
    category: "network",
    observation: "NETWORK_EGRESS",
    severity: "medium",
    pattern: /\b((?:\d{1,3}\.){3}\d{1,3})(?::\d{2,5})?\b/,
    describe: (m) => `hard-coded IP address ${m[1]}`,
    ignore: (m, line) =>
      /^(127\.|0\.0\.0\.0|255\.|10\.|192\.168\.|1\.0\.0\.0$)/.test(m[1]) ||
      m[1].split(".").some((o) => Number(o) > 255) ||
      /version|semver|\d+\.\d+\.\d+\.\d+-/.test(line.toLowerCase()) ||
      /"version"\s*:/.test(line),
  },
  {
    id: "js.sensitive-path",
    category: "filesystem",
    observation: "FS_SENSITIVE_READ",
    severity: "high",
    pattern: SENSITIVE,
    describe: (m) => `references sensitive path '${m[1]}'`,
  },
  {
    id: "js.child-process",
    category: "process",
    observation: "PROCESS_SPAWN",
    severity: "medium",
    pattern: /(?:require\(\s*|from\s+)['"`](?:node:)?child_process['"`]|\b(execSync|execFileSync|spawnSync|execFile|spawn|fork)\s*\(|\bexec\s*\(\s*['"`]/,
    describe: () => "spawns a child process / shell",
  },
  {
    id: "js.secret-env",
    category: "environment",
    observation: "ENV_SECRET_READ",
    severity: "high",
    pattern: SECRET_ENV,
    describe: (m) => `reads secret-looking environment variable ${m[1]}`,
  },
  {
    id: "js.env-dump",
    category: "environment",
    observation: "ENV_SECRET_READ",
    severity: "high",
    pattern: /(JSON\.stringify\(\s*process\.env\s*\)|Object\.(keys|entries|values)\(\s*process\.env\s*\)|\{\s*\.\.\.process\.env\s*\})/,
    describe: () => "serializes the entire environment (all variables, including secrets)",
  },
  {
    id: "js.dynamic-eval",
    category: "code-exec",
    observation: "DYNAMIC_CODE_EXEC",
    severity: "medium",
    pattern: /\beval\s*\(|new\s+Function\s*\(|\bvm\.(runInNewContext|runInThisContext|runInContext|Script)\b/,
    describe: () => "evaluates dynamically constructed code",
  },
  {
    id: "js.encoded-payload",
    category: "obfuscation",
    observation: "OBFUSCATED_CODE",
    severity: "medium",
    pattern: /['"`]([A-Za-z0-9+/]{200,}={0,2})['"`]|(\\x[0-9a-fA-F]{2}){24,}|Buffer\.from\([^)]*['"`](base64|hex)['"`]\)/,
    describe: (m) => (m[1] ? `long base64-like literal (${m[1].length} chars)` : "decodes an encoded payload at runtime"),
  },
  {
    id: "js.persistence",
    category: "persistence",
    observation: "PERSISTENCE",
    severity: "high",
    pattern: /(\.bashrc|\.zshrc|\.bash_profile|\.profile['"`]|crontab|\/etc\/cron|systemctl\s+enable|LaunchAgents|\.config\/autostart)/,
    describe: (m) => `touches a persistence location '${m[1]}'`,
  },
  {
    id: "js.fs-write-absolute",
    category: "filesystem",
    observation: "FS_WRITE_OUTSIDE_PACKAGE",
    severity: "medium",
    pattern: /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(\s*(?:['"`](\/|~)|os\.homedir|path\.join\(\s*os\.homedir|process\.env\.HOME)/,
    describe: (m) => `writes to an absolute or home-directory path via ${m[1]}`,
  },
  {
    id: "js.homedir",
    category: "filesystem",
    observation: null,
    severity: "info",
    pattern: /\bos\.homedir\(\)|process\.env\.(HOME|USERPROFILE)\b/,
    describe: () => "resolves the user's home directory",
  },
];

export const SHELL_RULES: LineRule[] = [
  {
    id: "sh.network-tool",
    category: "network",
    observation: "NETWORK_EGRESS",
    severity: "high",
    pattern: /\b(curl|wget|nc|ncat|socat|telnet)\b|\/dev\/(tcp|udp)\//,
    describe: (m) => `invokes network tool ${m[1] ?? "/dev/tcp"}`,
  },
  {
    id: "sh.pipe-to-shell",
    category: "code-exec",
    observation: "DYNAMIC_CODE_EXEC",
    severity: "high",
    pattern: /\|\s*(ba|z)?sh\b|\beval\s+["'$`]|base64\s+(-d|--decode)/,
    describe: () => "executes downloaded or decoded content",
  },
  {
    id: "sh.setuid",
    category: "permissions",
    observation: "SETUID_BINARY",
    severity: "medium",
    pattern: /chmod\s+([ugoa]*\+s|[2467][0-7]{3})\b/,
    describe: () => "sets setuid/setgid permission bits",
  },
  {
    id: "sh.persistence",
    category: "persistence",
    observation: "PERSISTENCE",
    severity: "medium",
    pattern: /systemctl\s+(enable|start)|crontab|\/etc\/cron|\.bashrc|\/etc\/profile/,
    describe: () => "configures a service, cron job or shell profile",
  },
  {
    id: "sh.sensitive-path",
    category: "filesystem",
    observation: "FS_SENSITIVE_READ",
    severity: "high",
    pattern: SENSITIVE,
    describe: (m) => `references sensitive path '${m[1]}'`,
  },
  {
    id: "sh.user-management",
    category: "permissions",
    observation: null,
    severity: "info",
    pattern: /\b(useradd|usermod|groupadd|passwd|visudo|sudoers)\b/,
    describe: (m) => `manages users or privileges (${m[1]})`,
  },
];

const JS_EXT = /\.(c|m)?js$|\.ts$|\.jsx$|\.tsx$/;
const isShellFile = (f: ArtifactFile) =>
  f.path === ".INSTALL" || /\.(sh|bash)$/.test(f.path) || (!!f.text && /^#!.*\b(ba|z|da)?sh\b/.test(f.text));
const MAX_PER_RULE_PER_FILE = 4;
const MAX_FACTS = 400;

function scanText(text: string, file: string, rules: LineRule[], push: (f: Omit<Fact, "id">) => boolean): void {
  const counts = new Map<string, number>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 20_000) continue; // minified blobs are reported by the encoded-payload rule elsewhere
    for (const rule of rules) {
      const m = line.match(rule.pattern);
      if (!m || rule.ignore?.(m, line)) continue;
      const n = counts.get(rule.id) ?? 0;
      if (n >= MAX_PER_RULE_PER_FILE) continue;
      counts.set(rule.id, n + 1);
      const ok = push({
        rule: rule.id,
        category: rule.category,
        severity: rule.severity,
        observation: rule.observation,
        source: "static",
        file,
        line: i + 1,
        snippet: line.trim().slice(0, 240),
        detail: rule.describe(m),
      });
      if (!ok) return;
    }
  }
}

/** Runs every static rule over a release and returns numbered facts. */
export function staticScan(artifact: ReleaseArtifact): Fact[] {
  const facts: Fact[] = [];
  const push = (f: Omit<Fact, "id">): boolean => {
    if (facts.length >= MAX_FACTS) return false;
    facts.push({ id: `S${facts.length + 1}`, ...f });
    return true;
  };

  push({
    rule: "integrity.artifact-hash",
    category: "integrity",
    severity: "info",
    observation: null,
    source: "static",
    detail: `artifact sha256 ${artifact.sha256} (${artifact.size} bytes, ${artifact.files.length} files)`,
  });
  if (artifact.registryIntegrity) {
    push({
      rule: "integrity.registry",
      category: "integrity",
      severity: artifact.registryIntegrity.verified ? "info" : "high",
      observation: null,
      source: "static",
      detail: artifact.registryIntegrity.verified
        ? `matches the registry-published digest ${artifact.registryIntegrity.value.slice(0, 32)}…`
        : `DOES NOT match the registry digest ${artifact.registryIntegrity.value}`,
    });
  }

  for (const [hook, body] of Object.entries(artifact.installScripts)) {
    push({
      rule: artifact.ecosystem === "npm" ? "npm.lifecycle-script" : "pacman.install-hook",
      category: "install-script",
      severity: "medium",
      observation: "INSTALL_SCRIPT",
      source: "static",
      file: artifact.ecosystem === "npm" ? "package.json" : ".INSTALL",
      snippet: body.slice(0, 240),
      detail: `runs '${hook}' automatically at install time`,
    });
    scanText(body, artifact.ecosystem === "npm" ? `package.json#scripts.${hook}` : `.INSTALL#${hook}`, SHELL_RULES, push);
  }

  for (const f of artifact.files) {
    if (f.text) {
      if (artifact.ecosystem === "npm" && JS_EXT.test(f.path)) scanText(f.text, f.path, JS_RULES, push);
      else if (isShellFile(f) && f.path !== ".INSTALL") scanText(f.text, f.path, SHELL_RULES, push);
    }
    if (artifact.ecosystem === "pacman" && !f.path.startsWith(".")) {
      if (f.mode & 0o6000) {
        push({
          rule: "pacman.setuid-file",
          category: "permissions",
          severity: "medium",
          observation: "SETUID_BINARY",
          source: "static",
          file: f.path,
          detail: `installed with mode ${(f.mode & 0o7777).toString(8)} (setuid/setgid)`,
        });
      }
      if (!/^(usr|etc|var|opt|srv|boot)\//.test(f.path)) {
        push({
          rule: "pacman.nonstandard-location",
          category: "filesystem",
          severity: "low",
          observation: "FS_WRITE_OUTSIDE_PACKAGE",
          source: "static",
          file: f.path,
          detail: "installs a file outside the standard filesystem hierarchy",
        });
      }
      if (/^(etc\/(cron\.|profile\.d\/|systemd\/system\/.*\.wants\/))/.test(f.path)) {
        push({
          rule: "pacman.persistence-file",
          category: "persistence",
          severity: "low",
          observation: "PERSISTENCE",
          source: "static",
          file: f.path,
          detail: "installs a cron job, login profile hook or enabled systemd unit",
        });
      }
    }
    if (artifact.ecosystem === "npm" && f.binary && f.size >= 4 && f.path.match(/\.(node|so|dylib|dll|exe)$|^bin\//)) {
      push({
        rule: "npm.native-binary",
        category: "metadata",
        severity: "low",
        observation: null,
        source: "static",
        file: f.path,
        detail: `ships a prebuilt native binary (${f.size} bytes)`,
      });
    }
  }
  return facts;
}

/** Which observations a set of facts supports. */
export function observationsIn(facts: Fact[]): Set<Observation> {
  return new Set(facts.map((f) => f.observation).filter((o): o is Observation => !!o));
}

