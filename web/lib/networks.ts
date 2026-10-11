// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Public facts about the Midnight test networks the demo ballots can live on.
// No keys here: this file is imported by client components.

export type NetworkName = 'preview' | 'preprod';

export const NETWORKS: Record<NetworkName, { label: string; indexerHost: string; explorer: string }> = {
  preview: { label: 'Midnight Preview', indexerHost: 'indexer.preview.midnight.network', explorer: 'https://preview.midnightexplorer.com' },
  preprod: { label: 'Midnight Preprod', indexerHost: 'Blockfrost’s Midnight Preprod indexer', explorer: 'https://preprod.midnightexplorer.com' },
};
