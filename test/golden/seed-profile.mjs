#!/usr/bin/env node
import { resolveProfile } from "../../dist/runtime.js";

const [backend, project] = process.argv.slice(2);
await resolveProfile({ backend }, project, new AbortController().signal);
