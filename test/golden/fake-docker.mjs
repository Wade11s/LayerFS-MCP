#!/usr/bin/env node
import { replayCanned } from "./fake-runtime.mjs";

replayCanned(process.env.LAYERFS_GOLDEN_SCRIPT, process.env.LAYERFS_GOLDEN_LOG, "docker");
