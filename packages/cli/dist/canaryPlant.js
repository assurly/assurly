"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.plantCanaryLocally = plantCanaryLocally;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const scanner_core_1 = require("@assurly/scanner-core");
async function plantCanaryLocally(options) {
    const base = options.apiBaseUrl.replace(/\/$/, '');
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(`${base}/api/v1/canary`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({ repo: options.repo }),
    });
    const payload = (await response.json().catch(() => null));
    if (!response.ok) {
        const message = payload && typeof payload === 'object' && payload.error?.message
            ? payload.error.message
            : `Plant failed with HTTP ${response.status}`;
        throw new Error(message);
    }
    const snippet = payload?.snippet?.trim() ?? '';
    if (!snippet) {
        throw new Error('The Assurly API did not return a plant snippet.');
    }
    const envPath = path.join(path.resolve(options.projectPath), '.env.example');
    const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const merged = (0, scanner_core_1.mergeCanaryPlantIntoEnvExample)(existing, snippet);
    if (merged.changed) {
        fs.writeFileSync(envPath, merged.content, 'utf8');
    }
    return { envPath, changed: merged.changed, callbackUrl: payload?.callbackUrl };
}
