import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getBridge } from "@/lib/bridge";
import { useSettingsStore } from "@/lib/settingsStore";
import {
  coerceThemeNameForAppearance,
  themesForAppearance,
} from "@/lib/themes";
import type { NightModePreference, UiFontScale } from "@/lib/types";
import {
  NIGHT_MODE_OPTIONS,
  UI_FONT_SCALE_OPTIONS,
  normalizeNightMode,
  normalizeUiFontScale,
  resolveAppearance,
  systemPrefersDark,
} from "@/lib/uiInterfacePrefs";
import { buildTerminalFontOptions } from "./terminalFontOptions";

export function InterfacePanel() {
  const settings = useSettingsStore((state) => state.settings);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [systemPrefersDarkScheme, setSystemPrefersDarkScheme] = useState(systemPrefersDark);

  useEffect(() => {
    let active = true;
    const getSystemFonts = getBridge()?.getSystemFonts;
    if (!getSystemFonts) return () => { active = false; };

    void getSystemFonts()
      .then((fonts) => {
        if (active && Array.isArray(fonts)) setSystemFonts(fonts);
      })
      .catch(() => {
        if (active) setSystemFonts([]);
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemPrefersDarkScheme(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const appearance = resolveAppearance(
    normalizeNightMode(settings.nightMode),
    systemPrefersDarkScheme,
  );
  const colorStyles = useMemo(() => themesForAppearance(appearance), [appearance]);

  useEffect(() => {
    const nextTheme = coerceThemeNameForAppearance(settings.themeName, appearance);
    if (nextTheme !== settings.themeName) {
      updateSetting("themeName", nextTheme);
    }
  }, [appearance, settings.themeName, updateSetting]);

  const fontOptions = useMemo(
    () => buildTerminalFontOptions(systemFonts, settings.fontFamily),
    [settings.fontFamily, systemFonts],
  );
  const uiFontOptions = useMemo(
    () => buildTerminalFontOptions(systemFonts, settings.uiFontFamily),
    [settings.uiFontFamily, systemFonts],
  );

  return (
    <SettingsGrid>
      <Panel section="Interface" title="Shell appearance">
        <SettingRow label="UI Font" description="Font family used across the Zorai interface chrome.">
          <select
            className="zorai-input"
            value={settings.uiFontFamily}
            onChange={(event) => updateSetting("uiFontFamily", event.target.value)}
            style={{ fontFamily: settings.uiFontFamily }}
          >
            {uiFontOptions.map((font) => (
              <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label="UI Font Size" description="Scale interface typography without changing terminal text size.">
          <select
            className="zorai-input"
            value={normalizeUiFontScale(settings.uiFontScale)}
            onChange={(event) => updateSetting("uiFontScale", event.target.value as UiFontScale)}
          >
            {UI_FONT_SCALE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label="Night Mode" description="Default stays on. Auto follows the system appearance preference.">
          <select
            className="zorai-input"
            value={normalizeNightMode(settings.nightMode)}
            onChange={(event) => updateSetting("nightMode", event.target.value as NightModePreference)}
          >
            {NIGHT_MODE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow
          label="Color Style"
          description={appearance === "light"
            ? "Light palettes for day mode shell and terminal accents."
            : "Dark palettes for night mode shell and terminal accents."}
        >
          <select
            className="zorai-input"
            value={coerceThemeNameForAppearance(settings.themeName, appearance)}
            onChange={(event) => updateSetting("themeName", event.target.value)}
          >
            {colorStyles.map((theme) => (
              <option key={theme.name} value={theme.name}>{theme.name}</option>
            ))}
          </select>
        </SettingRow>
      </Panel>

      <Panel section="Terminal" title="Shell presentation">
        <SettingRow label="Terminal Font" description="Font used by standard and infinite-canvas terminals.">
          <select
            className="zorai-input"
            value={settings.fontFamily}
            onChange={(event) => updateSetting("fontFamily", event.target.value)}
            style={{ fontFamily: settings.fontFamily }}
          >
            {fontOptions.map((font) => (
              <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
            ))}
          </select>
        </SettingRow>
        <NumberRow
          label="Font Size"
          description="Terminal text size in pixels."
          value={settings.fontSize}
          onChange={(value) => updateSetting("fontSize", value)}
          min={8}
          max={28}
        />
        <DecimalNumberRow
          label="Line Height"
          description="Terminal row-height multiplier."
          value={settings.lineHeight}
          onChange={(value) => updateSetting("lineHeight", value)}
          min={0.8}
          max={2}
          step={0.1}
        />
        <Metric label="Terminal focus" value="tab:focus" />
        <Metric label="Threads" value="ctrl+t" />
        <Metric label="Goals" value="ctrl+g" />
      </Panel>
    </SettingsGrid>
  );
}

function SettingsGrid({ children }: { children: ReactNode }) {
  return <div className="zorai-settings-grid">{children}</div>;
}

function Panel({ section, title, children }: { section: string; title: string; children: ReactNode }) {
  return (
    <div className="zorai-panel">
      <div><div className="zorai-section-label">{section}</div><h2>{title}</h2></div>
      {children}
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div className="zorai-setting-row">
      <div><strong>{label}</strong><span>{description}</span></div>
      {children}
    </div>
  );
}

function NumberRow({
  label,
  description,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
}) {
  return (
    <SettingRow label={label} description={description}>
      <input
        className="zorai-input"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </SettingRow>
  );
}

function DecimalNumberRow({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <SettingRow label={label} description={description}>
      <input
        className="zorai-input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </SettingRow>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="zorai-setting-row">
      <div><strong>{label}</strong><span>{value}</span></div>
    </div>
  );
}
