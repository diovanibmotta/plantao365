#!/usr/bin/env node
// Wrapper versionado: existe já no `npm install`, antes do build gerar dist/cli.js.
import { main } from '../dist/cli.js';

process.exit(await main(process.argv.slice(2)));
