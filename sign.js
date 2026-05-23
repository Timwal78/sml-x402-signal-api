// Ed25519 response signing — verifiable trust signal for agents.
// Each paid response carries _sig {alg, publicKey, signature} over canonical JSON.
// Generate a stable keypair once:  node sign.js --gen   then set RESPONSE_SIGNING_KEY.

import crypto from "crypto";

// Stable, deterministic JSON (sorted keys) so signer and verifier agree.
function canonical(obj) {
  if (Array.isArray(obj)) return "[" + obj.map(canonical).join(",") + "]";
  if (obj && typeof obj === "object")
    return "{" + Object.keys(obj).sort().map(k => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
  return JSON.stringify(obj);
}

let privateKey, publicKeyB64;
const SEED = process.env.RESPONSE_SIGNING_KEY; // base64 PKCS8 DER
if (SEED) {
  privateKey = crypto.createPrivateKey({ key: Buffer.from(SEED, "base64"), format: "der", type: "pkcs8" });
} else {
  const kp = crypto.generateKeyPairSync("ed25519");
  privateKey = kp.privateKey;
  if (process.env.NODE_ENV !== "test")
    console.warn("WARN: RESPONSE_SIGNING_KEY not set — using EPHEMERAL key (changes on restart).");
}
publicKeyB64 = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64");

export function signPayload(payload) {
  const msg = Buffer.from(canonical(payload));
  const signature = crypto.sign(null, msg, privateKey).toString("base64url");
  return { ...payload, _sig: { alg: "ed25519", publicKey: publicKeyB64, signature } };
}

export const PUBLIC_KEY = publicKeyB64;

// CLI: print a fresh keypair to configure the server.
if (process.argv[2] === "--gen") {
  const kp = crypto.generateKeyPairSync("ed25519");
  const priv = kp.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  const pub = kp.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  console.log("RESPONSE_SIGNING_KEY (private, keep secret):\n" + priv + "\n");
  console.log("Public key (publish for verifiers):\n" + pub);
}
