# Dual Gauge Card

> 🔧 **Maintained fork** of [custom-cards/dual-gauge-card](https://github.com/custom-cards/dual-gauge-card) (original project abandoned since 2021).
> This version fixes several bugs introduced by recent Home Assistant updates.

A Lovelace card displaying two concentric gauges in a single visual component — great for comparing two related sensors (e.g. power and current, actual vs. target temperature, etc.).

![dual-gauge-card-screenshot](https://user-images.githubusercontent.com/2353088/43733272-5f59d8fe-99b4-11e8-8161-0c55e096b862.png)

---

## ✨ What's new in v0.6.0

- **Fix gauge overlap** : CSS bug that made values completely unreadable on recent HA versions
- **Fix `precision` option** : rounding had no effect at all, sensors were showing raw 10+ digit numbers
- **Automatic data positioning** : when a `title:` is set, values shift up automatically to leave room for it; without a title, they sit lower
- **Centered display** : outer and inner values meet at the center of the dial (outer right-aligned, inner left-aligned) for a cleaner and more readable layout

---

## Installation

### Via HACS (recommended)

1. In HACS, click **Custom repositories**
2. Add the URL of this repo and select category **Lovelace**
3. Install **Dual Gauge Card** from the list
4. Reload Home Assistant

### Manually

1. Download `dual-gauge-card.js`
2. Place it in `/config/www/`
3. Go to **Settings → Dashboards → Resources** and add:
   - URL: `/local/dual-gauge-card.js`
   - Type: **JavaScript Module**
4. Reload Home Assistant

> 💡 **Tip**: When updating the file manually, append a version suffix to the URL (e.g. `/local/dual-gauge-card.js?v=2`) to force the browser to fetch the new version instead of serving the cached one.

---

## Configuration

### General options

| Option             | Type    | Default | Description |
|--------------------|---------|---------|-------------|
| `title`            | string  | —       | Title displayed at the bottom center of the gauge |
| `min`              | number  | `0`     | Shared minimum value for both gauges |
| `max`              | number  | `100`   | Shared maximum value for both gauges |
| `precision`        | number  | `2`     | Number of decimal places (inherited by `inner` and `outer` if not set individually) |
| `cardwidth`        | number  | `300`   | Card width in pixels |
| `background_color` | string  | —       | Background color of the gauge track |
| `shadeInner`       | boolean | `true`  | Darkens the inner gauge by 25% to visually distinguish it from the outer one |

### `inner` and `outer` options

These options apply identically to both gauges. Values defined at the individual level (`inner:` / `outer:`) take priority over shared ones.

| Option      | Type   | Default       | Description |
|-------------|--------|---------------|-------------|
| `entity`    | string | **required**  | HA entity to display |
| `attribute` | string | —             | Entity attribute to use (if different from `state`) |
| `label`     | string | —             | Text shown below the value |
| `unit`      | string | —             | Unit appended after the value |
| `min`       | number | shared value  | Minimum for this gauge |
| `max`       | number | shared value  | Maximum for this gauge |
| `precision` | number | shared value  | Decimal places for this gauge |
| `colors`    | list   | —             | Color thresholds based on value (see below) |

### Color configuration

Colors are defined as a list of thresholds. The first entry whose `value` is less than or equal to the current sensor value is used. The last entry acts as the default fallback color.

The list is sorted automatically — no need to order it in your config.

Colors can be defined once at the root level for both gauges, or individually per gauge.

---

## Examples

### DSMR P1 reader (power + current)

```yaml
type: custom:dual-gauge-card
precision: 2
inner:
  colors:
    - color: var(--label-badge-red)
      value: 37
    - color: var(--label-badge-yellow)
      value: 35
    - color: var(--label-badge-green)
      value: 0
  entity: sensor.dsmr_reader_current_l1
  label: Amp
  max: 40
  min: 0
outer:
  colors:
    - color: var(--label-badge-red)
      value: 9
    - color: var(--label-badge-yellow)
      value: 7
    - color: var(--label-badge-green)
      value: 0
  entity: sensor.dsmr_reader_power_consumed
  label: kW
  max: 9
  min: 0
```

### Thermostat (current vs. target temperature)

```yaml
type: custom:dual-gauge-card
title: Living Room
min: -20
max: 40
precision: 1
outer:
  entity: climate.living_room
  attribute: current_temperature
  label: Current
  unit: "°C"
  min: -30
  max: 50
inner:
  entity: climate.living_room
  attribute: temperature
  label: Target
  unit: "°C"
  colors:
    - color: var(--label-badge-green)
      value: 25
    - color: var(--label-badge-yellow)
      value: 18
    - color: var(--label-badge-blue)
      value: 0
```

---

## Credits

- Original project: [Rocka84/dual-gauge-card](https://github.com/custom-cards/dual-gauge-card) — MIT license
- Fork & fixes: [@TheD6Bel](https://github.com/thed6bel)
