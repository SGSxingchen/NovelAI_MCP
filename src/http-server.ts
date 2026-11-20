#!/usr/bin/env node

import { startHttpServer } from './http-app.js';
import { logFatal } from './runtime.js';

startHttpServer('sse').catch(logFatal);
