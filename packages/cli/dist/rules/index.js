"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allRules = void 0;
const envRules_1 = require("./envRules");
const supabaseRules_1 = require("./supabaseRules");
const stripeRules_1 = require("./stripeRules");
const vercelRules_1 = require("./vercelRules");
const ciRules_1 = require("./ciRules");
const tsconfigRules_1 = require("./tsconfigRules");
const dbPoolRules_1 = require("./dbPoolRules");
const rscRules_1 = require("./rscRules");
const coldStartRules_1 = require("./coldStartRules");
const sqlSafetyRules_1 = require("./sqlSafetyRules");
const deeperStackRules_1 = require("./deeperStackRules");
/**
 * Array containing all static analysis rules implemented in ShipReady.
 */
exports.allRules = [
    envRules_1.envRules,
    supabaseRules_1.supabaseRules,
    stripeRules_1.stripeRules,
    vercelRules_1.vercelRules,
    ciRules_1.ciRules,
    tsconfigRules_1.tsconfigRules,
    dbPoolRules_1.dbPoolRules,
    rscRules_1.rscRules,
    coldStartRules_1.coldStartRules,
    sqlSafetyRules_1.sqlSafetyRules,
    deeperStackRules_1.deeperStackRules,
];
