# Asset Attribution

All assets in this project are CC0 (Creative Commons Zero) / public domain, or original procedural work. No assets from Mojang Studios, Microsoft, or any other proprietary source are included.

CC0 does not legally require attribution, but the open-source community norm is to credit creators. This file records every external asset used.

---

## How to Add a Row

When you add a CC0 texture:

1. Download the asset and confirm its license is CC0 1.0 Universal (or equivalent public domain dedication).
2. Place the source file under `public/textures/sources/`.
3. Add one row to the table below.
4. Run `scripts/verify-cc0.sh` to confirm the build still passes the G1 gate.

---

## Asset Table

| Asset name              | Atlas tile(s) | Source / Author      | License      | URL                            | Notes                          |
|-------------------------|---------------|----------------------|--------------|--------------------------------|--------------------------------|
| stone (procedural)      | 1             | Original (this repo) | Public domain | —                             | Hash-based speckle; no external file |
| dirt (procedural)       | 2             | Original (this repo) | Public domain | —                             | Hash-based speckle             |
| grass\_top (procedural) | 3             | Original (this repo) | Public domain | —                             | Flat color + micro noise       |
| grass\_side (procedural)| 4             | Original (this repo) | Public domain | —                             | Flat color + micro noise       |
| sand (procedural)       | 5             | Original (this repo) | Public domain | —                             | Hash-based speckle             |
| water (procedural)      | 6             | Original (this repo) | Public domain | —                             | Flat color + micro noise       |
| oak\_log\_side (proc.)  | 7             | Original (this repo) | Public domain | —                             | Wood-grain vertical streaks    |
| oak\_log\_end (proc.)   | 8             | Original (this repo) | Public domain | —                             | Wood-grain streaks             |
| oak\_leaves (proc.)     | 9             | Original (this repo) | Public domain | —                             | Dappled leaf pattern           |
| oak\_planks (proc.)     | 10            | Original (this repo) | Public domain | —                             | Wood-grain streaks             |
| cobblestone (proc.)     | 11            | Original (this repo) | Public domain | —                             | Hash-based speckle             |
| glass (procedural)      | 12            | Original (this repo) | Public domain | —                             | Flat color + micro noise       |
| coal\_ore (proc.)       | 13            | Original (this repo) | Public domain | —                             | Hash-based speckle             |
| iron\_ore (proc.)       | 14            | Original (this repo) | Public domain | —                             | Hash-based speckle             |
| gold\_ore (proc.)       | 15            | Original (this repo) | Public domain | —                             | Hash-based speckle             |
| redstone\_ore (proc.)   | 16            | Original (this repo) | Public domain | —                             | Hash-based speckle             |
| diamond\_ore (proc.)    | 17            | Original (this repo) | Public domain | —                             | Hash-based speckle             |
| lapis\_ore (proc.)      | 18            | Original (this repo) | Public domain | —                             | Hash-based speckle             |
| bedrock (procedural)    | 19            | Original (this repo) | Public domain | —                             | Hash-based speckle             |
| snow (procedural)       | 20            | Original (this repo) | Public domain | —                             | Flat color + micro noise       |
| gravel (procedural)     | 21            | Original (this repo) | Public domain | —                             | Hash-based speckle             |
| crafting\_table\_top    | 22            | Original (this repo) | Public domain | —                             | Wood-grain; no real art yet    |
| crafting\_table\_bottom | 23            | Original (this repo) | Public domain | —                             | Wood-grain                     |
| crafting\_table\_side   | 24            | Original (this repo) | Public domain | —                             | Wood-grain                     |
| furnace\_top (proc.)    | 25            | Original (this repo) | Public domain | —                             | Flat color + micro noise       |
| furnace\_side (proc.)   | 26            | Original (this repo) | Public domain | —                             | Flat color + micro noise       |
| furnace\_front (proc.)  | 27            | Original (this repo) | Public domain | —                             | Flat color + micro noise       |
| torch (procedural)      | 28            | Original (this repo) | Public domain | —                             | Flat color + micro noise       |
| glowstone (proc.)       | 29            | Original (this repo) | Public domain | —                             | Flat color + micro noise       |
| lava (procedural)       | 30            | Original (this repo) | Public domain | —                             | Flat color + micro noise       |
| birch\_log\_side (proc.)| 31            | Original (this repo) | Public domain | —                             | Wood-grain vertical streaks    |
| birch\_log\_end (proc.) | 32            | Original (this repo) | Public domain | —                             | Wood-grain streaks             |
| birch\_leaves (proc.)   | 33            | Original (this repo) | Public domain | —                             | Dappled leaf pattern           |
| birch\_planks (proc.)   | 34            | Original (this repo) | Public domain | —                             | Wood-grain streaks             |
| bed (procedural)        | 35            | Original (this repo) | Public domain | —                             | Flat color + micro noise       |

---

## When Real Textures Land

Replace the "Original (this repo)" rows with the actual source information. Example row for a real CC0 texture:

```
| stone                   | 1             | ambientCG            | CC0 1.0 Universal | https://ambientcg.com/view?id=Rock046 | Downloaded 2026-06-15, 1K resolution |
```

Keep this file committed and up to date. `scripts/verify-cc0.sh` checks that the file exists and is non-empty as part of the G1 gate.
