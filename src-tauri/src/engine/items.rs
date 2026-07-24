// Copyright 2021 Tom A. Wagner <tom.a.wagner@protonmail.com>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License version 3 as published by
// the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: GPL-3.0-only
//
// Derived from Helvum 0.6.2 src/pipewire_connection/state.rs at commit
// e124603c1d15a8d6b51803068c01fcbb0f5d383a. Modified in 2026 for
// Cordflow: GTK-facing link indexes were replaced by registry metadata.

use std::collections::HashMap;

pub enum RegistryItem {
    Node,
    Port,
    Link,
    Metadata,
}

#[derive(Default)]
pub struct RegistryItems {
    items: HashMap<u32, RegistryItem>,
}

impl RegistryItems {
    pub fn insert(&mut self, id: u32, item: RegistryItem) {
        self.items.insert(id, item);
    }

    pub fn contains(&self, id: u32) -> bool {
        self.items.contains_key(&id)
    }

    pub fn remove(&mut self, id: u32) -> Option<RegistryItem> {
        self.items.remove(&id)
    }
}
