import { useState, useEffect } from "react";

const NAVY = "#1B3A6B";
const GOLD = "#C9A84C";
const DARK = "#0d1b2a";

function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const listener = (e) => setMatches(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);
  return matches;
}

const ASSIGNMENT_TYPES = [
  { value: "worksheet", label: "Worksheet" },
  { value: "test", label: "Test / Quiz" },
  { value: "rubric", label: "Rubric" },
  { value: "project", label: "Project Brief" },
  { value: "essay", label: "Essay Prompt" },
  { value: "lab", label: "Lab Report" },
  { value: "journal", label: "Journal Prompt" },
  { value: "bellringer", label: "Bell Ringer" },
  { value: "exitticket", label: "Exit Ticket" },
];

const SOURCE_OPTIONS = [
  {
    value: "lgp",
    label: "Lesson Plan Generator",
    desc: "Paste your LPG output",
    note: "This content was already verified when your lesson plan was generated. The verification process is not repeated here — the tool builds directly from your confirmed lesson.",
    noteType: "ok",
  },
  {
    value: "ag",
    label: "Activity Generator",
    desc: "Paste your AG output",
    note: "This content was already verified when your activity was generated. The verification process is not repeated here — the tool builds directly from your confirmed activity.",
    noteType: "ok",
  },
  {
    value: "previous",
    label: "Previous Assignment",
    desc: "Convert to a new type",
    note: "This option is designed for assignments already created through the 4THDMC Teacher Toolkit. Paste your existing worksheet, test, rubric, or other toolkit assignment output here to convert it to a new type. For content from outside the toolkit, use Starting from Scratch instead — that path includes full verification.",
    noteType: "warn",
  },
  {
    value: "scratch",
    label: "Starting from Scratch",
    desc: "Build something new",
    note: null,
    noteType: null,
  },
];

const Label = ({ text, required }) => (
  <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", marginBottom: 7 }}>
    {text}{required && <span style={{ color: GOLD }}> *</span>}
  </div>
);

const renderResult = (text) =>
  text.split("\n").map((line, i) => {
    const t = line.trim();
    if (!t) return <div key={i} style={{ height: 8 }} />;
    if (/^[A-Z][A-Z\s\/\(\)]{3,}$/.test(t) && t.length < 60) {
      return (
        <div key={i} style={{ fontWeight: 800, fontSize: 15, color: NAVY, borderLeft: `4px solid ${GOLD}`, paddingLeft: 12, margin: "18px 0 8px" }}>
          {t}
        </div>
      );
    }
    if (/^\d+[\.\)]\s/.test(t)) {
      return <div key={i} style={{ fontWeight: 700, fontSize: 14, color: "#222", margin: "6px 0" }}>{t}</div>;
    }
    if (t.startsWith("-") || t.startsWith("•")) {
      return (
        <div key={i} style={{ display: "flex", gap: 9, margin: "4px 0 4px 10px", fontSize: 14, color: "#333", lineHeight: 1.6 }}>
          <span style={{ color: GOLD, fontWeight: 900, flexShrink: 0 }}>•</span>
          <span>{t.replace(/^[-•]\s*/, "")}</span>
        </div>
      );
    }
    return <div key={i} style={{ fontSize: 14, color: "#444", lineHeight: 1.7, margin: "3px 0" }}>{t}</div>;
  });

export default function App() {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const [source, setSource] = useState("");
  const [assignmentType, setAssignmentType] = useState("");
  const [questionCount, setQuestionCount] = useState("10");
  const [pastedContent, setPastedContent] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [topic, setTopic] = useState("");
  const [extras, setExtras] = useState("");
  const [hasFactualContent, setHasFactualContent] = useState(false);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const [limit, setLimit] = useState(null);

  const [verificationRan, setVerificationRan] = useState(false);
  const [verificationType, setVerificationType] = useState("");
  const [computationalPassed, setComputationalPassed] = useState(null);

  const [unlocked, setUnlocked] = useState(
    typeof window !== "undefined" && localStorage.getItem("toolkit_unlocked") === "yes"
  );
  const [pwInput, setPwInput] = useState("");
  const [authChecking, setAuthChecking] = useState(false);
  const [authError, setAuthError] = useState("");

  const inp = (extra = {}) => ({
    width: "100%",
    background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: isDesktop ? 8 : 10,
    color: "#fff",
    padding: isDesktop ? "11px 14px" : "14px 16px",
    fontSize: isDesktop ? 14 : 16,
    outline: "none",
    fontFamily: "inherit",
    boxSizing: "border-box",
    WebkitAppearance: "none",
    ...extra,
  });

  const tryUnlock = async () => {
    if (!pwInput.trim() || authChecking) return;
    setAuthChecking(true);
    setAuthError("");
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwInput.trim() }),
      });
      if (r.ok) {
        const data = await r.json();
        localStorage.setItem("toolkit_password", pwInput.trim());
        localStorage.setItem("toolkit_unlocked", "yes");
        setRemaining(data.remaining);
        setLimit(data.limit);
        setUnlocked(true);
      } else {
        setAuthError("Incorrect access code. Try again.");
      }
    } catch {
      setAuthError("Connection error. Try again.");
    } finally {
      setAuthChecking(false);
    }
  };

  const generate = async () => {
    if (!source || !assignmentType) return;
    if (source === "scratch" && (!subject || !grade || !topic)) {
      setError("Please fill in Subject, Grade Level, and Topic.");
      return;
    }
    if (source !== "scratch" && !pastedContent.trim()) {
      setError("Please paste your content before generating.");
      return;
    }
    setError("");
    setResult("");
    setLoading(true);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolkitPassword: localStorage.getItem("toolkit_password") || "",
          source,
          assignmentType,
          questionCount,
          pastedContent,
          subject,
          grade,
          topic,
          extras,
          hasFactualContent,
        }),
      });

      const json = await res.json();

      if (json.error) {
        if (json.error.code === "AUTH_REQUIRED") {
          localStorage.removeItem("toolkit_unlocked");
          localStorage.removeItem("toolkit_password");
          setUnlocked(false);
          setError("That access code is no longer valid. Please re-enter.");
          return;
        }
        if (json.error.code === "LIMIT_REACHED") {
          setError(json.error.message);
          setRemaining(0);
          return;
        }
        setError("Error: " + json.error.message);
        return;
      }

      if (!json.text) { setError("Nothing returned. Please try again."); return; }

      setResult(json.text);
      setVerificationRan(json.verificationRan);
      setVerificationType(json.verificationType || "");
      setComputationalPassed(json.computationalPassed);
      if (json.remaining !== undefined) setRemaining(json.remaining);
      if (json.limit !== undefined) setLimit(json.limit);

    } catch (e) {
      setError("Request failed: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    setResult("");
    setError("");
    setSource("");
    setAssignmentType("");
    setQuestionCount("10");
    setPastedContent("");
    setSubject("");
    setGrade("");
    setTopic("");
    setExtras("");
    setHasFactualContent(false);
    setVerificationRan(false);
    setVerificationType("");
    setComputationalPassed(null);
  };

  const selectedSourceObj = SOURCE_OPTIONS.find((s) => s.value === source);

  const isQuickGen = ["rubric", "bellringer", "exitticket", "journal"].includes(assignmentType)
    || ["lgp", "ag"].includes(source);
  const isPreviousSource = source === "previous";

  const timingNote = loading
    ? "Running verification and building your assignment — this may take up to 60-90 seconds. No need to refresh or click again."
    : isQuickGen
    ? "This generation goes straight to building — no full verification pass needed."
    : isPreviousSource
    ? "A light check runs on this content before generating the new assignment type."
    : source && assignmentType
    ? "Generation includes verification passes. May take 60-90 seconds depending on content complexity."
    : "Select a source and assignment type to begin.";

  const RemainingBadge = () => remaining !== null ? (
    <div style={{ color: remaining <= 2 ? "#ffb066" : "rgba(255,255,255,0.4)", fontSize: 11, letterSpacing: 1 }}>
      {remaining} of {limit} generations left
    </div>
  ) : null;

  const VerifBox = () => {
    const style = { borderRadius: 12, padding: "14px 16px", marginBottom: 16, fontSize: 12, lineHeight: 1.6 };
    if (verificationType === "trusted-source") {
      return (
        <div style={{ ...style, background: "rgba(27,58,107,0.3)", border: "1px solid rgba(201,168,76,0.2)", color: "rgba(255,255,255,0.6)" }}>
          This content was already verified when it was originally generated. No additional verification was needed.
        </div>
      );
    }
    if (!verificationRan || verificationType === "none") {
      return (
        <div style={{ ...style, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>
          No verification pass was needed for this assignment type or content.
        </div>
      );
    }
    if (computationalPassed === false) {
      return (
        <div style={{ ...style, background: "rgba(255,176,102,0.12)", border: "1px solid rgba(255,176,102,0.4)", color: "#ffb066" }}>
          <strong>Math could not be independently verified.</strong> Simpler or generic examples were used. Review before distributing to students.
        </div>
      );
    }
    const msg = verificationType === "both" ? "Facts and math both verified before generation."
      : verificationType === "math" ? "Math independently verified using two methods."
      : verificationType === "facts" ? "Facts verified via web search."
      : "Content check completed.";
    return (
      <div style={{ ...style, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>
        <strong style={{ color: GOLD }}>{msg}</strong>
      </div>
    );
  };

  // ── LOCK SCREEN ────────────────────────────────────────────────────────
  if (!unlocked) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: `linear-gradient(160deg, ${DARK} 0%, ${NAVY} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', system-ui, sans-serif", padding: 20 }}>
        <div style={{ maxWidth: 380, width: "100%", textAlign: "center", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(201,168,76,0.25)", borderRadius: 12, padding: "40px 32px" }}>
          <div style={{ display: "inline-block", border: `1px solid ${GOLD}`, color: GOLD, fontSize: 10, letterSpacing: 4, padding: "4px 14px", marginBottom: 20, fontWeight: 700, borderRadius: 2, textTransform: "uppercase", fontFamily: "monospace" }}>4THDMC | EVOLVE LLC</div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 900, color: "#fff", marginBottom: 10 }}>Assignment Generator</div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, marginBottom: 28, lineHeight: 1.5 }}>Enter your access code to continue.</div>
          <input
            type="password"
            value={pwInput}
            disabled={authChecking}
            onChange={(e) => { setPwInput(e.target.value); setAuthError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") tryUnlock(); }}
            placeholder="Access code"
            style={{ width: "100%", boxSizing: "border-box", padding: "13px 16px", background: "rgba(255,255,255,0.07)", border: `1px solid ${authError ? "rgba(255,80,80,0.5)" : "rgba(255,255,255,0.2)"}`, borderRadius: 8, color: "#fff", fontSize: 15, outline: "none", marginBottom: authError ? 8 : 16, opacity: authChecking ? 0.6 : 1 }}
          />
          {authError && <div style={{ color: "#ff9090", fontSize: 12, marginBottom: 16, textAlign: "left" }}>{authError}</div>}
          <button
            disabled={authChecking || !pwInput.trim()}
            onClick={tryUnlock}
            style={{ width: "100%", padding: 14, background: authChecking ? "rgba(201,168,76,0.5)" : GOLD, color: DARK, border: "none", borderRadius: 8, fontWeight: 900, fontSize: 14, letterSpacing: 2, cursor: authChecking ? "wait" : "pointer", textTransform: "uppercase" }}
          >{authChecking ? "Checking..." : "Unlock Tool"}</button>
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, marginTop: 20, lineHeight: 1.5 }}>Not a subscriber yet? Visit brrteaching.com to join.</div>
        </div>
      </div>
    );
  }

  const formContent = (
    <>
      {/* SOURCE SELECTOR */}
      <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "20px 18px", marginBottom: 14 }}>
        <div style={{ color: GOLD, fontWeight: 700, fontSize: 11, letterSpacing: 3, textTransform: "uppercase", marginBottom: 14 }}>Step 1 — Content Source</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: selectedSourceObj ? 14 : 0 }}>
          {SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSource(opt.value)}
              style={{
                background: source === opt.value ? "rgba(201,168,76,0.1)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${source === opt.value ? GOLD : "rgba(255,255,255,0.15)"}`,
                borderRadius: 10, padding: "12px 14px", cursor: "pointer", textAlign: "left", transition: "all 0.15s",
              }}
            >
              <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, display: "block", marginBottom: 3 }}>{opt.label}</span>
              <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, display: "block" }}>{opt.desc}</span>
            </button>
          ))}
        </div>

        {selectedSourceObj && selectedSourceObj.note && (
          <div style={{
            background: selectedSourceObj.noteType === "warn" ? "rgba(255,176,102,0.08)" : "rgba(42,157,92,0.08)",
            border: `1px solid ${selectedSourceObj.noteType === "warn" ? "rgba(255,176,102,0.3)" : "rgba(42,157,92,0.3)"}`,
            color: selectedSourceObj.noteType === "warn" ? "#ffb066" : "#5ab4e8",
            borderRadius: 8, padding: "10px 12px", fontSize: 12, lineHeight: 1.5,
          }}>
            {selectedSourceObj.noteType === "warn" && <strong>Important: </strong>}
            {selectedSourceObj.note}
          </div>
        )}

        {source && source !== "scratch" && (
          <div style={{ marginTop: 14 }}>
            <Label text={source === "lgp" ? "Paste Lesson Plan Generator Output" : source === "ag" ? "Paste Activity Generator Output" : "Paste Previous Assignment"} required />
            <textarea
              value={pastedContent}
              onChange={(e) => setPastedContent(e.target.value)}
              placeholder={source === "lgp" ? "Paste your LPG output here..." : source === "ag" ? "Paste your AG output here..." : "Paste your toolkit assignment here..."}
              rows={7}
              style={{ ...inp(), resize: "vertical", lineHeight: 1.5 }}
            />
          </div>
        )}

        {source === "scratch" && (
          <>
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <Label text="Subject" required />
                <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Business" style={inp()} />
              </div>
              <div>
                <Label text="Grade Level" required />
                <select value={grade} onChange={(e) => setGrade(e.target.value)} style={inp({ background: "#162d52", color: grade ? "#fff" : "rgba(255,255,255,0.35)" })}>
                  <option value="">Select...</option>
                  {["K","1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th","11th","12th","College"].map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <Label text="Topic" required />
              <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Compound Interest" style={inp()} />
            </div>
            <div style={{ marginTop: 12 }}>
              <Label text="Extra Direction (optional)" />
              <input value={extras} onChange={(e) => setExtras(e.target.value)} placeholder="e.g. No calculator, real-world examples" style={inp()} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, cursor: "pointer", marginTop: 12 }}>
              <input type="checkbox" checked={hasFactualContent} onChange={(e) => setHasFactualContent(e.target.checked)} style={{ width: 16, height: 16, accentColor: GOLD, cursor: "pointer" }} />
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>This content includes specific facts, dates, names, or numbers that should be verified</span>
            </label>
          </>
        )}
      </div>

      {/* ASSIGNMENT TYPE SELECTOR */}
      {source && (
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "20px 18px", marginBottom: 14 }}>
          <div style={{ color: GOLD, fontWeight: 700, fontSize: 11, letterSpacing: 3, textTransform: "uppercase", marginBottom: 14 }}>Step 2 — Assignment Type</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 7 }}>
            {ASSIGNMENT_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setAssignmentType(t.value)}
                style={{
                  background: assignmentType === t.value ? "rgba(201,168,76,0.12)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${assignmentType === t.value ? GOLD : "rgba(255,255,255,0.12)"}`,
                  borderRadius: 8, padding: "10px 8px", cursor: "pointer", textAlign: "center",
                  color: assignmentType === t.value ? GOLD : "rgba(255,255,255,0.6)",
                  fontSize: 12, fontWeight: 600, transition: "all 0.15s",
                }}
              >{t.label}</button>
            ))}
          </div>

          {assignmentType === "test" && (
            <div style={{ marginTop: 14 }}>
              <Label text="Number of Questions" />
              <div style={{ display: "flex", gap: 8 }}>
                {["5", "10", "15", "20"].map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuestionCount(q)}
                    style={{
                      flex: 1, padding: "10px 4px", borderRadius: 8,
                      border: `1px solid ${questionCount === q ? GOLD : "rgba(255,255,255,0.2)"}`,
                      background: questionCount === q ? "rgba(201,168,76,0.18)" : "transparent",
                      color: questionCount === q ? GOLD : "rgba(255,255,255,0.55)",
                      fontWeight: 700, fontSize: 14, cursor: "pointer",
                    }}
                  >{q}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ERROR */}
      {error && (
        <div style={{ background: "rgba(255,80,80,0.12)", border: "1px solid rgba(255,80,80,0.3)", color: "#ff9090", padding: "12px 16px", borderRadius: 8, fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>{error}</div>
      )}

      {/* GENERATE BUTTON */}
      <button
        onClick={generate}
        disabled={loading || !source || !assignmentType || remaining === 0}
        style={{
          width: "100%", padding: 18, border: "none", borderRadius: 12, fontWeight: 900,
          fontSize: 16, letterSpacing: 3, textTransform: "uppercase", transition: "all 0.2s",
          background: (loading || !source || !assignmentType || remaining === 0) ? "rgba(201,168,76,0.4)" : GOLD,
          color: DARK,
          cursor: (loading || !source || !assignmentType || remaining === 0) ? "not-allowed" : "pointer",
          boxShadow: (loading || !source || !assignmentType || remaining === 0) ? "none" : "0 4px 24px rgba(201,168,76,0.3)",
        }}
      >
        {loading ? "Building Your Assignment..." : remaining === 0 ? "Monthly Limit Reached" : "GENERATE ASSIGNMENT"}
      </button>
      <div style={{ textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
        {timingNote}
      </div>
    </>
  );

  const resultContent = result && (
    <>
      <div style={{ background: "#fff", borderRadius: 16, padding: "26px 20px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)", marginBottom: 16 }}>
        <div style={{ marginBottom: 18, paddingBottom: 14, borderBottom: `2px solid ${GOLD}` }}>
          <div style={{ display: "inline-block", background: "rgba(201,168,76,0.12)", border: `1px solid ${GOLD}`, color: GOLD, fontSize: 10, fontWeight: 700, letterSpacing: 2, padding: "4px 10px", borderRadius: 20, marginBottom: 8, textTransform: "uppercase" }}>Ready to Use</div>
          <div style={{ color: "#999", fontSize: 12 }}>
            {ASSIGNMENT_TYPES.find((t) => t.value === assignmentType)?.label} · {SOURCE_OPTIONS.find((s) => s.value === source)?.label}
          </div>
        </div>
        <div>{renderResult(result)}</div>
      </div>

      <VerifBox />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button onClick={copy} style={{ padding: 16, background: copied ? "#2a9d5c" : NAVY, color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}>
          {copied ? "Copied!" : "Copy Assignment"}
        </button>
        <button onClick={reset} style={{ padding: 16, background: "transparent", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer", textTransform: "uppercase" }}>
          New Assignment
        </button>
      </div>
    </>
  );

  const footer = (
    <div style={{ textAlign: "center", color: "rgba(255,255,255,0.18)", fontSize: 10, letterSpacing: 3, textTransform: "uppercase", marginTop: 20, padding: "0 16px 24px" }}>
      <div>© 2026 <span style={{ color: "rgba(201,168,76,0.55)" }}>4THDMC | EVOLVE LLC</span> · All Rights Reserved</div>
      <div style={{ marginTop: 6, fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.12)" }}>Brandon Russell · The Multiplier · Chattanooga, TN</div>
    </div>
  );

  // ── MOBILE LAYOUT ──────────────────────────────────────────────────────
  if (!isDesktop) {
    return (
      <div style={{ minHeight: "100vh", background: `linear-gradient(160deg, ${DARK} 0%, ${NAVY} 100%)`, fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "0 0 80px" }}>
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 900, fontSize: 14, color: "#fff", letterSpacing: 1 }}>4THDMC <span style={{ color: GOLD }}>|</span> EVOLVE LLC</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <RemainingBadge />
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase" }}>Teacher Toolkit</div>
          </div>
        </div>

        <div style={{ textAlign: "center", padding: "28px 20px 20px" }}>
          <div style={{ display: "inline-block", border: `1px solid ${GOLD}`, color: GOLD, fontSize: 10, letterSpacing: 4, padding: "5px 14px", marginBottom: 12, fontWeight: 700, borderRadius: 2 }}>4THDMC | EVOLVE LLC</div>
          <div style={{ fontSize: "clamp(28px,8vw,44px)", fontWeight: 900, color: "#fff", lineHeight: 1.1 }}>
            ASSIGNMENT<br /><span style={{ color: GOLD }}>GENERATOR</span>
          </div>
          <div style={{ width: 40, height: 3, background: GOLD, margin: "12px auto 8px" }} />
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, fontStyle: "italic" }}>Verified assignments grounded in your real lesson. No slop.</div>
        </div>

        <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px" }}>
          {!result ? formContent : resultContent}
        </div>
        {footer}
      </div>
    );
  }

  // ── DESKTOP LAYOUT ─────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(135deg, ${DARK} 0%, ${NAVY} 60%, ${DARK} 100%)`, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "16px 48px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 900, fontSize: 18, color: "#fff", letterSpacing: 1 }}>4THDMC <span style={{ color: GOLD }}>|</span> EVOLVE LLC</div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <RemainingBadge />
          <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, fontStyle: "italic" }}>Assignment Generator</div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 40px 80px", display: "grid", gridTemplateColumns: result ? "1fr 1fr" : "1fr", gap: 32, alignItems: "start" }}>
        <div>
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 42, fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: 1 }}>ASSIGNMENT<br /><span style={{ color: GOLD }}>GENERATOR</span></div>
            <div style={{ width: 40, height: 3, background: GOLD, margin: "14px 0 12px" }} />
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, fontStyle: "italic" }}>Verified assignments grounded in your real lesson. No slop.</div>
          </div>
          {formContent}
        </div>

        {result && (
          <div style={{ background: "#fff", borderRadius: 14, padding: "32px 28px", boxShadow: "0 24px 60px rgba(0,0,0,0.4)", position: "sticky", top: 24, maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, paddingBottom: 16, borderBottom: `2px solid ${GOLD}`, flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ background: "rgba(201,168,76,0.12)", border: `1px solid ${GOLD}`, color: GOLD, fontSize: 10, fontWeight: 700, letterSpacing: 2, padding: "4px 10px", borderRadius: 20, marginBottom: 8, display: "inline-block", textTransform: "uppercase" }}>Ready to Use</div>
                <div style={{ color: "#999", fontSize: 12 }}>
                  {ASSIGNMENT_TYPES.find((t) => t.value === assignmentType)?.label} · {SOURCE_OPTIONS.find((s) => s.value === source)?.label}
                </div>
              </div>
            </div>
            <div>{renderResult(result)}</div>
            <VerifBox />
            <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <button onClick={copy} style={{ flex: 1, padding: "12px 16px", background: copied ? "#2a9d5c" : NAVY, color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>
                {copied ? "Copied!" : "Copy"}
              </button>
              <button onClick={reset} style={{ flex: 1, padding: "12px 16px", background: "transparent", color: NAVY, border: `1px solid ${NAVY}`, borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", textTransform: "uppercase" }}>
                Reset
              </button>
            </div>
          </div>
        )}
      </div>
      {footer}
    </div>
  );
}
