// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Tell Desk: private, provable responsible disclosure and on-chain privacy grades.
// The browser-safe parts (codec, view, witnesses) import nothing from Node.

export * from './codec.js';
export * from './contract.js';
export * from './witnesses.js';
export * from './view.js';
export * from './client.js';
export { DeskSimulator, type PublicView, type ProverView } from './simulator.js';
