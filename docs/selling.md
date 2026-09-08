# Selling HeliStrike

A practical note on storefronts, price, and what buyers treat as a finished game. This is not legal advice. Platform rules change; confirm against the linked docs before you pay a fee or set a price.

HeliStrike today is a strong **prototype of a loop**: one craft, one seeded map, four weapons, HV hunt. That is enough to show people. It is not enough to charge Steam’s usual heli-arcade price without looking unfinished next to what is already on the store.

---

## Recommendation in one page

1. **Ship a paid itch.io build first** (Windows zip + macOS if you already run it locally). Low friction, you keep most of the money, you learn if strangers will pay.
2. **Treat Steam as the real commercial launch**, after the loop has sound, a pause/settings flow, a mission structure, and enough variety that a $10 purchase does not feel like “one map, then R.”
3. **Price on Steam at $9.99**, with a launch discount to **$8.49 / ~15% off**. Do not start at $4.99 (hard to climb out of the bargain bin) and do not start at $14.99 unless you have campaign + multiple craft + multiple theaters comparable to *Cleared Hot*.
4. **Skip Epic / GOG until Steam is live.** Both are extra packaging and review work; they do not replace Steam discovery for a small action game.

---

## What similar games actually charge

These are the closest live comps (Desert Strike / gunship arcade, not DCS):

| Title | What they sell | USD list (approx., 2026) |
| --- | --- | --- |
| [Blue Fury](https://store.steampowered.com/app/4634590/Blue_Fury/) | 16-bit heli combat, proc-gen islands, campaign + quick missions, fuel/ammo, rescue | $9.99 |
| [Megacopter: Blades of the Goddess](https://store.steampowered.com/app/1228360/Megacopter_Blades_of_the_Goddess/) | Strike-like campaign, several biomes, upgrades, story missions | $9.99 |
| [Cleared Hot](https://store.steampowered.com/app/1710820/Cleared_Hot/) | Physics heli shooter, campaign, 8 craft, 3 biomes, loadouts (Early Access) | $14.99 |
| Generic arcade shmups / tiny arena shooters | Short loops, little meta | $4.99–$6.99 |

Valve’s own pricing guidance is: playtime, replayability, similar titles, and whether you will discount later — not “undercut everyone.” See [Steamworks: Pricing](https://partner.steamgames.com/doc/store/pricing). After launch you generally **cannot discount for 30 days** (except a launch discount you set up in advance), and a **price increase starts another 30-day discount cooldown**.

**Suggested bands for this project**

| Band | Price | When it is honest |
| --- | --- | --- |
| Prototype / jam | Free or PWYW on itch | Current build: no audio, no campaign, one craft |
| Arcade 1.0 | **$9.99** Steam / **$7.99–$9.99** itch | Sound, pause, a mission wrapper, 2–3 theaters or gen presets, 2–3 craft or loadouts, a demo |
| Content-heavy | $14.99 | Cleared Hot-shaped: authored campaign chapters, many craft, several biomes, upgrades |

itch.io can be **pay-what-you-want with a $5 minimum** while you are still iterating. Steam should be a fixed SKU.

Net to you on a $9.99 Steam sale at the default **70/30** split is about **$7** before tax withholding and refunds. itch.io’s default is **you pick the platform cut** (commonly 10%), plus card fees (~2.9% + $0.30). Epic’s public program is **100% of the first $1M net per product per year**, then **88/12** ([Epic revenue share](https://store.epicgames.com/en-US/distribution/revenue-programs/revenue-share)); getting *onto* Epic is the hard part, not the cut.

---

## Steam: how you actually sell there

Official path: [Onboarding](https://partner.steamgames.com/doc/gettingstarted/onboarding), [Steam Direct fee](https://partner.steamgames.com/doc/gettingstarted/appfee), [Release process](https://partner.steamgames.com/doc/store/releasing).

**Money and time**

- **$100 USD per app**, not refundable, recouped as a line item after **$1,000 adjusted gross revenue**.
- First-time partners: identity + tax/bank paperwork, then a **30-day wait** from paying the fee until you are allowed to release.
- Store page must be a public **Coming Soon** page for **at least 14 days** before release. Wishlisting happens here; many teams leave Coming Soon up for months, not two weeks.
- Two Valve reviews (store presence, then build), typically **a few business days** each. Submit store presence **at least 7 days** before you need it live.
- You click **Release App** yourself; approved games do not auto-launch.

**What the store page must include** (not optional marketing):

- Capsules and library art at Valve’s current sizes ([assets overview](https://partner.steamgames.com/doc/store/assets)): header 920×430, small 462×174, main 1232×706, vertical 748×896, library capsule 600×900, library hero 3840×1240, plus icons. Capsules need the **game name on the image**.
- **At least 5 gameplay screenshots**, 1920×1080 16:9, real play — not menus, not mockups with marketing text ([screenshots](https://partner.steamgames.com/doc/store/assets/standard)).
- **A trailer** (1080p, ~30 or 60 fps) ([trailers](https://partner.steamgames.com/doc/store/trailer)).
- Short description, about-this-game copy, tags, supported languages, system requirements.
- **Content Survey** (violence, etc.) which drives age ratings on the page ([content survey](https://partner.steamgames.com/doc/gettingstarted/contentsurvey)).
- Proposed **pricing in all Steam currencies**. Missing a currency = unbuyable in that country.

**Build**

- Steam expects a **Windows playable build** as the default. macOS/Linux are optional extras.
- This repo is a **Vite + Phaser web game**. Steam does not sell “open this URL.” You wrap it (Tauri, Electron, or similar), ship an installer or a folder with an `.exe`, and optionally talk to [Steamworks SDK](https://partner.steamgames.com/doc/sdk) for overlay, achievements, cloud, and ownership checks.
- The reviewed default branch must include **everything the store page claims**. You can patch after.

**Steam-shaped extras buyers notice**

- A **demo** (separate App ID, can share files with the full game). Strongly worth it for a skill-based arcade game.
- Achievements, a pause menu, settings (fullscreen, volume, rebind or at least documented keys).
- Controller support is optional; mouse + keys is honest for this game if you say so on the page.
- Refunds: Steam’s usual **2 hours playtime / 2 weeks** window. A 20-minute “one seed and crash” loop will generate refunds if people feel tricked.

**Early Access** is allowed, but you still need a store page that does not overclaim, and a public EA plan. *Cleared Hot* is using EA at $14.99 because the campaign is shipping in chapters. Do not use EA as a synonym for “missing sound.”

---

## Elsewhere

| Store | Fit | Cost / cut | Notes |
| --- | --- | --- | --- |
| **itch.io** | Best first commercial page | $0; you set their %, default 10%, plus processor fees | HTML5 embed *or* downloadable. PWYW, demo, and “name your price” are normal. Weak discovery vs Steam. |
| **Your own site** | Fine as a backup | Processor fees only | Stripe/Gumroad/itch widget. You do all discovery. |
| **Epic Games Store** | Optional second SKU | $0 to apply; 100% of first $1M/year then 88/12 | Application / relationship, not an open queue like Steam Direct. Extra launcher packaging. |
| **GOG** | Optional, DRM-free crowd | Curated; historically ~70% to you | Quality bar and Galaxy SDK. Apply when the 1.0 is stable. |
| **Humble** | Occasional bundles | Deal-dependent | Better as a later promo than a launch store. |
| **Mobile / consoles** | Not a first release | Store cuts + cert | Touch and TV controls are a different game. Ignore until PC sells. |

A reasonable sequence: **itch (paid or PWYW) → Steam Coming Soon + demo → Steam 1.0 → consider GOG/Epic if there is demand.**

---

## Base content people expect at $10

Steam reviews punish “tech demo priced as a game.” For a heli arcade at **$9.99**, the comps above sell some combination of **authored missions**, **multiple maps or biomes**, **more than one gunship**, and **audio**. Procedural generation is a feature, not a substitute for a beginning/middle/end.

**Must-have (do not ship Steam without these)**

- Sound: rotor, guns, rockets, explosions, at least a thin music bed or stingers.
- Pause, volume, fullscreen, a way to quit to desktop that is not Alt+F4 only.
- A mission wrapper: briefing or objective list, win/lose screens, restart that does not feel like a debug key.
- The loop you already have, **stable**: HV hunt, weapons that read, terrain LOS, wrecks that stay.
- Difficulty or a clear “this is arcade-hard” framing so refunds are not “I died in 90 seconds and want my money.”
- Trailer + screenshots that match the build.
- No debug/config-rig leftovers in the public build.

**Should-have (this is what $9.99 reviews compare you against)**

- More than one **theater / gen preset** (your TODO list: desert, arctic, islands, etc.).
- More than one **player craft** or a real loadout choice (even 3 crafts is a store-page bullet).
- A **short campaign or mission list** on top of endless seeds (10–20 missions is what *Blue Fury* advertises; you do not need 30).
- A **demo**: one map, one craft, limited ammo or a time/objective cap.
- Steam achievements that map to real play (first HV, all HV, survive X, complete a theater).

**Nice-for-$15 / post-1.0**

- Full campaign chapters, night/thermal, more weapons, last-stand mode, designed (not only seeded) maps. That is DLC or a price bump, not the minimum SKU.

**Do not put on the store page until it is in the build.** If the page says “campaign, 8 helicopters, 3 biomes,” Valve and players will check.

---

## Legal and naming (easy way to get the page rejected)

Steam’s rules plus ordinary trademark law:

- **Apache, Hellfire, TOW, Cobra, Osprey, Warthog** as product names are other people’s marks (and some are US Army/manufacturer names). The current HUD copy is prototype language. Ship with fictional craft and weapon names, or generic descriptions (“chain gun,” “wire-guided missile”).
- Do not call it a *Desert Strike* sequel or use EA Strike art/audio. “Inspired by 90s gunship games” is the usual safe framing.
- Complete the content survey honestly (military violence, explosions). You do not need a paid ESRB box for Steam if you use Valve’s questionnaire path, unless a specific territory later requires it.

---

## Rough cost to *list*, not to *market*

| Item | Ballpark |
| --- | --- |
| Steam Direct fee | $100 (recouped after $1k AGR) |
| Capsules / trailer / screenshot pass | DIY or a few hundred if you hire |
| Windows wrapper + installer + smoke test | Your time; budget a dedicated week |
| Tax/entity setup | Accountant, once |
| Marketing | Optional. Trailer + wishlist + a couple of YouTube/Discord heli or “Strike-like” posts is the realistic floor. Influencers and paid wishlists are a different budget. |

Break-even on the $100 fee alone is on the order of **~15 Steam copies** at $9.99 after the 30% cut. That is not the real cost. The real cost is finishing audio, mission structure, and a Windows build.

---

## Sources

- [Steam Direct fee](https://partner.steamgames.com/doc/gettingstarted/appfee)
- [Steam onboarding](https://partner.steamgames.com/doc/gettingstarted/onboarding)
- [Release process](https://partner.steamgames.com/doc/store/releasing)
- [Pricing](https://partner.steamgames.com/doc/store/pricing)
- [Store assets](https://partner.steamgames.com/doc/store/assets)
- [Trailers](https://partner.steamgames.com/doc/store/trailer)
- [Content survey](https://partner.steamgames.com/doc/gettingstarted/contentsurvey)
- [itch.io payments / open revenue share](https://itch.io/docs/creators/payments)
- [Epic Games Store revenue share](https://store.epicgames.com/en-US/distribution/revenue-programs/revenue-share)
