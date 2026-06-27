// Assignment Generator API proxy — source-aware verify then generate
// © 2026 4THDMC | EVOLVE LLC. All Rights Reserved.
//
// SETUP IN VERCEL (Settings → Environment Variables):
//   ANTHROPIC_API_KEY = your rotated Anthropic API key
//   KV_REST_API_URL   = from Upstash dashboard
//   KV_REST_API_TOKEN = from Upstash dashboard
//
// ARCHITECTURE — source-aware pipeline with four input paths:
//
// 1. TRUSTED SOURCE (LPG or AG output):
//    Content already verified upstream — skip all verification, generate directly.
//
// 2. PREVIOUS ASSIGNMENT (toolkit-generated only):
//    Light single-pass check for anything that looks stale or incorrect,
//    then generate the new assignment type.
//
// 3. RUBRIC (any source):
//    Rubrics contain criteria and scoring levels, not verifiable claims.
//    Skip verification entirely, generate directly.
//
// 4. SHORT-FORM TYPES (Bell Ringer, Exit Ticket, Journal Prompt):
//    Classify first. Almost always returns "nothing to verify" — goes straight
//    to generation. If claims detected, runs a light check.
//
// 5. SCRATCH INPUT (all other types):
//    Full classify → verify factual (web search) → verify computational
//    (two method-diverse passes) → generate pipeline, same as LPG and AG.
//
// Test/Quiz capped at 20 questions. Teacher selects count before generating.
// Human touchpoints: source selector, type selector, question count, factual checkbox.

import { Redis } from '@upstash/redis';

async function callAnthropic({ model, maxTokens, prompt, useWebSearch }) {
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (useWebSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (data.error) return { ok: false, text: '', raw: data };
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return { ok: true, text, raw: data };
}

function getTypeInstructions(type, questionCount) {
  const map = {
    worksheet: `Create a WORKSHEET students will complete to practice the content. Include clear instructions, varied question types (multiple choice, short answer, fill-in-the-blank as appropriate), and a complete TEACHER ANSWER KEY section at the end.`,
    test: `Create a TEST / QUIZ with exactly ${questionCount} questions. Number each question clearly. Include a mix of question types appropriate for the content (multiple choice, short answer, true/false as appropriate). Include a complete TEACHER ANSWER KEY at the end.`,
    rubric: `Create a RUBRIC for evaluating student work on this topic. Include 4-6 criteria rows, 4 performance levels (Excellent/4, Proficient/3, Developing/2, Beginning/1), point values per criterion, and a total points line. Format clearly using plain text.`,
    project: `Create a PROJECT BRIEF students can follow independently. Include a clear overview, specific learning objectives, detailed requirements, a suggested timeline with milestones, submission instructions, and a grading breakdown.`,
    essay: `Create an ESSAY PROMPT with context and background, the actual essay question, requirements (length, format, source expectations), and the criteria teachers will use to evaluate it.`,
    lab: `Create a LAB REPORT template with objective, brief background, materials list, step-by-step procedure, data collection section with recording spaces, analysis questions, and a conclusion prompt.`,
    journal: `Create a JOURNAL PROMPT with the main reflective prompt, 2-3 guiding questions to help develop thinking, a length expectation, and a Name / Date line.`,
    bellringer: `Create a BELL RINGER warm-up activity designed for 5 minutes at the start of class. Include 2-3 focused questions or a brief task that activates prior knowledge or previews today's lesson. Keep it short and immediately usable.`,
    exitticket: `Create an EXIT TICKET with 2-4 focused check questions that assess whether students understood the key concept. Include a Name / Date line. Keep it to half a page or less.`,
  };
  return map[type] || 'Create an educational assignment appropriate for the content.';
}

function getOutputFormat(type, questionCount) {
  const map = {
    worksheet: `TITLE\nSTUDENT INFORMATION (Name / Date / Period)\nINSTRUCTIONS\n[Questions and Tasks]\nTEACHER ANSWER KEY`,
    test: `TITLE\nSTUDENT INFORMATION (Name / Date / Period / Score)\nINSTRUCTIONS\nQUESTIONS (numbered 1 through ${questionCount})\nTEACHER ANSWER KEY`,
    rubric: `TITLE\nASSIGNMENT DESCRIPTION\nCRITERIA TABLE (Criterion | Excellent 4 | Proficient 3 | Developing 2 | Beginning 1 | Points)\nTOTAL POINTS`,
    project: `TITLE\nOVERVIEW\nLEARNING OBJECTIVES\nREQUIREMENTS\nTIMELINE\nSUBMISSION INSTRUCTIONS\nGRADING BREAKDOWN`,
    essay: `TITLE\nCONTEXT\nPROMPT\nREQUIREMENTS\nEVALUATION CRITERIA`,
    lab: `TITLE\nOBJECTIVE\nBACKGROUND\nMATERIALS\nPROCEDURE\nDATA COLLECTION\nANALYSIS QUESTIONS\nCONCLUSION`,
    journal: `TITLE\nPROMPT\nGUIDING QUESTIONS\nLENGTH EXPECTATION\nName: ___________ Date: ___________`,
    bellringer: `BELL RINGER\nTopic: [topic]\nTime: 5 minutes\n[2-3 questions or brief task]`,
    exitticket: `EXIT TICKET\nTopic: [topic]\nName: ___________ Date: ___________\n[2-4 check questions]`,
  };
  return map[type] || 'TITLE\nINSTRUCTIONS\n[Content]';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const {
    toolkitPassword,
    source,
    assignmentType,
    questionCount,
    pastedContent,
    subject,
    grade,
    topic,
    extras,
    hasFactualContent,
  } = req.body || {};

  // ── SUBSCRIBER VALIDATION VIA REDIS ───────────────────────────────────
  if (!toolkitPassword) {
    return res.status(401).json({ error: { message: 'Access code required.', code: 'AUTH_REQUIRED' } });
  }

  const redisUrl = process.env.KV_REST_API_URL;
  const redisToken = process.env.KV_REST_API_TOKEN;

  if (!redisUrl || !redisToken) {
    return res.status(500).json({ error: { message: 'Server configuration error.' } });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: { message: 'Server configuration error: ANTHROPIC_API_KEY not set.' } });
  }

  const redis = new Redis({ url: redisUrl, token: redisToken });
  const key = 'subscriber:' + toolkitPassword.trim().toLowerCase();

  let record;
  try {
    const raw = await redis.get(key);

    if (raw === null || raw === undefined) {
      return res.status(401).json({ error: { message: 'Invalid or expired access code.', code: 'AUTH_REQUIRED' } });
    }

    if (typeof raw === 'string') {
      try { record = JSON.parse(raw); } catch (e) { record = null; }
    } else {
      record = raw;
    }

    if (!record || typeof record.limit === 'undefined') {
      return res.status(500).json({ error: { message: 'Account data error. Contact brandon@4thdmc.com.' } });
    }

    const now = Date.now();
    if (now > record.resetAt) {
      record.used = 0;
      record.resetAt = now + 30 * 24 * 60 * 60 * 1000;
      await redis.set(key, JSON.stringify(record));
    }

    if (record.used >= record.limit) {
      return res.status(429).json({
        error: {
          message: `You've used all ${record.limit} generations for this month. Your limit resets on ${new Date(record.resetAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`,
          code: 'LIMIT_REACHED',
        },
      });
    }
  } catch (err) {
    return res.status(500).json({ error: { message: 'Server error during validation. Please try again.' } });
  }

  // ── INPUT VALIDATION ──────────────────────────────────────────────────
  if (!source || !assignmentType) {
    return res.status(400).json({ error: { message: 'Source and assignment type are required.' } });
  }

  if (source === 'scratch' && (!subject || !grade || !topic)) {
    return res.status(400).json({ error: { message: 'Subject, Grade Level, and Topic are required when starting from scratch.' } });
  }

  if (source !== 'scratch' && !pastedContent) {
    return res.status(400).json({ error: { message: 'Please paste your content before generating.' } });
  }

  const safeQuestionCount = ['5', '10', '15', '20'].includes(String(questionCount)) ? questionCount : '10';
  const SHORT_FORM = ['bellringer', 'exitticket', 'journal'];
  const contentForGen = source === 'scratch'
    ? `Subject: ${subject}\nGrade: ${grade}\nTopic: ${topic}\n${extras ? 'Extra notes: ' + extras : ''}`
    : pastedContent;

  const typeInstructions = getTypeInstructions(assignmentType, safeQuestionCount);
  const outputFormat = getOutputFormat(assignmentType, safeQuestionCount);

  let verificationBlock = '';
  let usageRule = '';
  let verificationType = 'none';
  let computationalPassed = null;
  let verificationRan = false;

  try {

    // ── PATH 1: TRUSTED SOURCE (LPG or AG) ──────────────────────────────
    if (source === 'lgp' || source === 'ag') {
      const sourceName = source === 'lgp' ? 'Lesson Plan Generator' : 'Activity Generator';
      verificationBlock = `Content sourced from the 4THDMC toolkit (${sourceName}). Verification was already completed when this content was originally generated. Use the content exactly as provided.`;
      usageRule = 'Use the provided content exactly as-is. Do not invent new facts, numbers, or examples beyond what is in the source material.';
      verificationType = 'trusted-source';

    // ── PATH 2: PREVIOUS ASSIGNMENT (toolkit-generated) ─────────────────
    } else if (source === 'previous') {
      verificationRan = true;
      const lightCheckPrompt = `Quickly scan this assignment for any factual claims or calculations that might be incorrect or outdated before creating a new version. Flag only specific items that look potentially wrong. If everything looks fine, say "CONTENT LOOKS CLEAN."

ASSIGNMENT:
${contentForGen}

Output: Either "CONTENT LOOKS CLEAN." or list specific flagged items, one per line.`;

      const lightCheck = await callAnthropic({
        model: 'claude-sonnet-4-6',
        maxTokens: 400,
        prompt: lightCheckPrompt,
      });

      const lightResult = lightCheck.ok ? lightCheck.text : 'CONTENT LOOKS CLEAN.';
      verificationBlock = /CONTENT LOOKS CLEAN/i.test(lightResult)
        ? 'Light check on previous toolkit assignment: content looks clean, no flags raised.'
        : `Light check flagged the following items for review:\n${lightResult}`;
      usageRule = 'Build the new assignment type from the provided content. Address any flagged items noted above.';
      verificationType = 'light-check';

    // ── PATH 3: RUBRIC — NO VERIFICATION NEEDED ─────────────────────────
    } else if (assignmentType === 'rubric') {
      verificationBlock = 'Rubric generation — criteria and scoring levels do not require factual or computational verification.';
      usageRule = 'Build clear, specific, fair rubric criteria appropriate for the assignment and grade level.';
      verificationType = 'none';

    // ── PATH 4: SHORT-FORM TYPES — CLASSIFY FIRST ───────────────────────
    } else if (SHORT_FORM.includes(assignmentType)) {
      const classifyPrompt = `Read this content and identify if it contains any specific factual claims or calculations that need verification. If yes, list them. If purely skills-based or open-ended with no verifiable claims, say "NOTHING TO VERIFY."

CONTENT:
${contentForGen}

Output: Either "NOTHING TO VERIFY" or list specific claims.`;

      const classResult = await callAnthropic({
        model: 'claude-sonnet-4-6',
        maxTokens: 300,
        prompt: classifyPrompt,
      });

      const classification = classResult.ok ? classResult.text : 'NOTHING TO VERIFY';

      if (/NOTHING TO VERIFY/i.test(classification)) {
        verificationBlock = 'No specific factual or computational claims detected for this short-form assignment type.';
        usageRule = 'Write a focused, grade-appropriate short-form assignment.';
        verificationType = 'none';
      } else {
        verificationRan = true;
        verificationBlock = `Claims noted: ${classification}. Use only well-established facts for this short-form assignment.`;
        usageRule = 'Stick to well-established, clearly accurate content. Avoid specific statistics or dates unless certain.';
        verificationType = 'light-check';
      }

    // ── PATH 5: SCRATCH — FULL PIPELINE ─────────────────────────────────
    } else {
      verificationRan = true;

      const classifyPrompt = `Read this content and identify every specific claim that could be checked for accuracy — regardless of subject area.

For each claim found, classify it as exactly one of:
- FACTUAL: a real-world claim that could be looked up (historical event, scientific fact, named person, business or economic principle, statistic)
- COMPUTATIONAL: a claim that requires a calculation or formula to verify (math, financial calculation, scientific formula, measurement conversion)

If there is nothing checkable (purely skills-based content with no factual or numeric claims), say "NOTHING TO VERIFY."

CONTENT:
${contentForGen}${hasFactualContent ? '\n\nNOTE: Teacher flagged this content as containing specific facts, dates, names, or numbers.' : ''}

Output format, one line per claim:
FACTUAL: [claim]
or
COMPUTATIONAL: [claim]
or just: NOTHING TO VERIFY`;

      const classResult = await callAnthropic({
        model: 'claude-sonnet-4-6',
        maxTokens: 500,
        prompt: classifyPrompt,
      });

      const classification = classResult.ok ? classResult.text : 'NOTHING TO VERIFY';
      const hasFactual = /FACTUAL:/i.test(classification);
      const hasComputational = /COMPUTATIONAL:/i.test(classification);

      if (!hasFactual && !hasComputational) {
        verificationBlock = 'No specific factual or computational claims detected in this content.';
        usageRule = 'Write naturally for this topic and grade level.';
        verificationType = 'none';
      } else {
        let factualNotes = '';
        let compNotes = '';

        // ── FACTUAL VERIFICATION ──────────────────────────────────────
        if (hasFactual) {
          const factCheckPrompt = `The following claims were identified in lesson content and need verification via web search.

Check EVERY claim, but report concisely: do NOT explain or describe claims that are simply confirmed accurate. Only give detail on claims that are INCORRECT or that need an important NUANCE a teacher should know before presenting to students.

CLAIMS TO VERIFY:
${classification}

CONTENT (for reference):
${contentForGen}

OUTPUT FORMAT — exactly this structure:
SUMMARY: [X] of [Y] claims confirmed accurate with no issues.

[Only include the section below if there is at least one flagged claim. If everything passed clean, end after the SUMMARY line.]

FLAGGED CLAIMS:
- [claim]: [INCORRECT or NUANCE] — [brief explanation and correction if needed]`;

          const factResult = await callAnthropic({
            model: 'claude-sonnet-4-6',
            maxTokens: 700,
            prompt: factCheckPrompt,
            useWebSearch: true,
          });
          factualNotes = factResult.ok ? factResult.text : 'Fact verification could not be completed.';
        }

        // ── COMPUTATIONAL VERIFICATION (two method-diverse passes) ────
        if (hasComputational) {
          const solvePrompt = `Solve the computational content in this lesson, showing full step-by-step work for each.

Go back to the CONTENT below and find every SPECIFIC numeric scenario actually written in it. Solve each one using its EXACT original numbers.

COMPUTATIONAL CLAIMS IDENTIFIED:
${classification}

CONTENT (the authoritative source for exact numbers):
${contentForGen}

For each individual numeric scenario, output EXACTLY these four lines, in this order, with no line ever left blank:
Problem: [restate it with its EXACT original numbers]
Method used: [name the method]
Worked solution: [full steps]
Answer: [the final numeric answer — this line is REQUIRED and must always contain the actual answer value]`;

          const passA = await callAnthropic({
            model: 'claude-sonnet-4-6',
            maxTokens: 1200,
            prompt: solvePrompt,
          });

          const passAText = passA.ok ? passA.text : '';

          const verifyPrompt = `Below are solved problems with their answers. Independently verify each answer using a DIFFERENT method than was likely used originally — if factoring was used, verify by expanding; if substitution was used, verify by solving directly; if one formula was used, verify with an alternate formula or by working backward.

Do not re-check the same way. Use a genuinely different approach for each problem. State clearly whether each answer is CONFIRMED or INCORRECT.

SOLVED PROBLEMS TO VERIFY:
${passAText}

For each problem, output:
Problem: [restate it]
Verification method used: [different from original]
Verification work: [show it]
Result: CONFIRMED or INCORRECT (if incorrect, state the correct answer)`;

          const passB = await callAnthropic({
            model: 'claude-sonnet-4-6',
            maxTokens: 1200,
            prompt: verifyPrompt,
          });

          const passBText = passB.ok ? passB.text : '';
          computationalPassed = !/INCORRECT/i.test(passBText) && passA.ok && passB.ok;

          compNotes = computationalPassed
            ? `${passAText}\n\n--- Independently re-verified using a different method: ---\n${passBText}`
            : `Verification found a discrepancy and could not confirm all problems independently. Original work:\n${passAText}\n\nVerification attempt:\n${passBText}`;
        }

        // ── SET VERIFICATION BLOCK AND USAGE RULES ───────────────────
        if (hasFactual && hasComputational) {
          verificationBlock = `FACTUAL CLAIMS — VERIFIED:\n${factualNotes}\n\nCOMPUTATIONAL CLAIMS — ${computationalPassed ? 'VERIFIED (two independent methods agree)' : 'COULD NOT BE FULLY VERIFIED'}:\n${compNotes}`;
          usageRule = computationalPassed
            ? 'Use ONLY the facts confirmed above and the EXACT verified numbers. Do not invent new factual claims or numeric examples.'
            : 'Use ONLY the facts confirmed above. Computational examples could not be fully verified — use generic descriptions instead of specific numbers.';
          verificationType = 'both';
        } else if (hasFactual) {
          verificationBlock = factualNotes;
          usageRule = 'Use only verified facts. Write generically for anything not confirmed.';
          verificationType = 'facts';
        } else {
          verificationBlock = compNotes;
          usageRule = computationalPassed
            ? 'Use EXACT verified numbers. Do not invent new examples.'
            : 'Computational examples could not be confirmed — use simpler well-known examples or describe processes generically.';
          verificationType = 'math';
        }
      }
    }

    // ── GENERATE THE ASSIGNMENT ────────────────────────────────────────
    const genPrompt = `You are an expert teacher creating a ready-to-use classroom assignment.

${typeInstructions}

CRITICAL RULES:
- Use PLAIN TEXT only. No markdown, no asterisks, no hashtags, no backticks.
- ${usageRule}
- Be specific to the content provided — not a generic template that could apply to any topic.
- Be concise but complete. Every section must be fully written. No placeholders.
- If this assignment includes a TEACHER ANSWER KEY, the answer key MUST be fully written. Never cut off mid-answer-key. Complete every single answer before ending your response.
- Do not stop early or leave any section incomplete under any circumstances.

CONTENT / LESSON DETAILS:
${contentForGen}

VERIFICATION RESULTS:
${verificationBlock}

OUTPUT FORMAT — use exactly these section headers in order:
${outputFormat}

Write the complete assignment now. Do not stop early or leave any section as a placeholder.`;

    const genResult = await callAnthropic({
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 3500,
      prompt: genPrompt,
    });

    if (!genResult.ok) {
      return res.status(500).json({ error: { message: genResult.raw?.error?.message || 'Generation failed.' } });
    }
    if (!genResult.text) {
      return res.status(500).json({ error: { message: 'Nothing was generated. Please try again.' } });
    }

    // ── DECREMENT USAGE IN REDIS ───────────────────────────────────────
    try {
      record.used += 1;
      await redis.set(key, JSON.stringify(record));
    } catch (err) {
      console.error('Failed to decrement usage:', err);
    }

    const remaining = record.limit - record.used;

    return res.status(200).json({
      text: genResult.text,
      verificationRan,
      verificationType,
      computationalPassed: assignmentType !== 'rubric' && !SHORT_FORM.includes(assignmentType) ? computationalPassed : null,
      verificationNotes: verificationBlock,
      remaining,
      limit: record.limit,
    });

  } catch (error) {
    return res.status(500).json({ error: { message: 'Proxy error: ' + error.message } });
  }
}
