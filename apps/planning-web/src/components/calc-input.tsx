"use client";

import { useEffect, useRef, useState } from "react";

/**
 * CalcInput — a text input that accepts a plain number or a small arithmetic
 * expression (e.g. "112.50 / 25", "(125 + 5) / 25 * 1.10"). On blur or Enter
 * the expression is evaluated and the field is rewritten with the result.
 *
 * Why not type="number"? Browsers reject anything with operators in number
 * inputs, so "112.50/25" gets silently dropped. We use a text input plus
 * inputMode="decimal" so mobile keyboards still show the numeric pad.
 *
 * Safety: input is whitelisted with a strict regex (digits, decimal point,
 * + - * /, parens, whitespace). Anything else fails before evaluation, so
 * the Function constructor never sees identifiers or property access.
 */

const EXPR_WHITELIST = /^[\d.+\-*/()\s]*$/;
const HAS_OPERATOR = /[+\-*/()]/;

function tryEvaluate(raw: string): { ok: true; value: number } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: NaN };

  if (!EXPR_WHITELIST.test(trimmed)) {
    return { ok: false, reason: "Only digits and + − × ÷ ( ) allowed" };
  }

  // Reject obviously malformed expressions before they hit Function.
  // Two consecutive operators (other than a leading minus) means typo.
  if (/[+*/]{2,}/.test(trimmed) || /[+\-*/]\s*$/.test(trimmed)) {
    return { ok: false, reason: "Incomplete expression" };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const result = new Function(`"use strict"; return (${trimmed});`)();
    if (typeof result !== "number" || !isFinite(result)) {
      return { ok: false, reason: "Not a number" };
    }
    return { ok: true, value: result };
  } catch {
    return { ok: false, reason: "Couldn't evaluate" };
  }
}

function formatResult(n: number, decimals: number): string {
  if (!isFinite(n) || isNaN(n)) return "";
  // Use fixed decimals but strip trailing zeros, similar to how a user would
  // hand-type the price. e.g. 4.5 not 4.50, 25 not 25.000.
  const fixed = n.toFixed(decimals);
  return fixed.replace(/\.?0+$/, "");
}

export type CalcInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** Decimal places when normalising the evaluated result. Default 4. */
  decimals?: number;
  /** Minimum allowed value (after evaluation). Default 0 (negatives rejected). Pass null to allow negatives. */
  min?: number | null;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  /** Optional prefix like "$" or "AUD" rendered inside the input. */
  prefix?: string;
  /** Optional suffix like "kg" or "%" rendered inside the input. */
  suffix?: string;
  /** Called on every keystroke (raw text). Useful if a parent needs to mirror state. */
  onRawChange?: (raw: string) => void;
  id?: string;
  name?: string;
  /** ARIA label for accessibility when there's no <label> sibling. */
  ariaLabel?: string;
};

export default function CalcInput({
  value,
  onChange,
  decimals = 4,
  min = 0,
  placeholder,
  className = "form-input",
  style,
  disabled,
  prefix,
  suffix,
  onRawChange,
  id,
  name,
  ariaLabel,
}: CalcInputProps) {
  const [raw, setRaw] = useState<string>(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const lastCommitted = useRef<string>(value ?? "");

  // Stay in sync with parent-provided value when it changes externally
  // (e.g. user picks a different supplier row to edit).
  useEffect(() => {
    if (value !== lastCommitted.current) {
      setRaw(value ?? "");
      lastCommitted.current = value ?? "";
      setError(null);
    }
  }, [value]);

  const isExpression = HAS_OPERATOR.test(raw);
  const preview = isExpression ? tryEvaluate(raw) : null;

  function commit() {
    const result = tryEvaluate(raw);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    if (isNaN(result.value)) {
      // Blank field — commit empty string so the parent's blank-handling
      // logic (e.g. "leave price unchanged") still works.
      setError(null);
      if (lastCommitted.current !== "") {
        lastCommitted.current = "";
        onChange("");
      }
      setRaw("");
      return;
    }
    if (min !== null && result.value < min) {
      setError(`Must be ≥ ${min}`);
      return;
    }
    const formatted = formatResult(result.value, decimals);
    setError(null);
    if (lastCommitted.current !== formatted) {
      lastCommitted.current = formatted;
      onChange(formatted);
    }
    setRaw(formatted);
  }

  const inputEl = (
    <input
      id={id}
      name={name}
      aria-label={ariaLabel}
      className={className}
      style={{
        ...(style ?? {}),
        ...(error ? { borderColor: "#dc2626", background: "#fef2f2" } : {}),
      }}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      placeholder={placeholder}
      value={raw}
      onChange={e => {
        const next = e.target.value;
        setRaw(next);
        if (error) setError(null);
        if (onRawChange) onRawChange(next);
      }}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          // Re-focus stays on the same input so the user can tweak — that
          // matches how spreadsheet cells behave.
        } else if (e.key === "Escape") {
          // Revert to last committed value.
          setRaw(lastCommitted.current);
          setError(null);
        }
      }}
    />
  );

  // Live preview hint while typing an expression — shows the user what their
  // formula evaluates to before they commit.
  const hint = (() => {
    if (error) return <span style={{ color: "#dc2626" }}>{error}</span>;
    if (!isExpression || !preview) return null;
    if (!preview.ok) return null; // Don't nag on incomplete expressions
    if (isNaN(preview.value)) return null;
    return (
      <span style={{ color: "#57534e" }}>
        = {formatResult(preview.value, decimals)}
      </span>
    );
  })();

  // If there's no prefix/suffix and nothing to hint, return the bare input so
  // existing layouts aren't disturbed.
  if (!prefix && !suffix && !hint) {
    return inputEl;
  }

  return (
    <div style={{ position: "relative" }}>
      {prefix || suffix ? (
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          {prefix && (
            <span style={{ position: "absolute", left: "0.625rem", color: "#78716c", fontSize: "0.8125rem", pointerEvents: "none" }}>
              {prefix}
            </span>
          )}
          {/* clone with padding-left to make room for the prefix */}
          {prefix
            ? <input
                {...(inputEl.props as React.InputHTMLAttributes<HTMLInputElement>)}
                style={{ ...(inputEl.props.style ?? {}), paddingLeft: "1.75rem" }}
              />
            : inputEl}
          {suffix && (
            <span style={{ position: "absolute", right: "0.625rem", color: "#78716c", fontSize: "0.8125rem", pointerEvents: "none" }}>
              {suffix}
            </span>
          )}
        </div>
      ) : (
        inputEl
      )}
      {hint && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: "0.125rem", fontSize: "0.7rem", lineHeight: 1.2, fontFamily: "monospace", whiteSpace: "nowrap", pointerEvents: "none" }}>
          {hint}
        </div>
      )}
    </div>
  );
}
