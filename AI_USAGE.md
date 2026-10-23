# AI Usage — Wilmarcs YouTube Video Presence Analyser

This file records AI assistance and validation practices for the assignment. Review it before submission and remove or correct any statement that does not match the tools and prompts actually used.

## AI coding assistant used

- **ChatGPT (OpenAI):** used to help reason about Flask/React integration, diagnose deployment configuration, review report-validation failures, improve error handling and watchlist UI feedback, and prepare documentation/deployment steps.
- Add any other coding assistants actually used (for example, Claude or GitHub Copilot) and describe their specific role. Do not claim a tool was used unless that is true.

## Representative prompt patterns

The following are representative summaries of the kinds of prompts used; replace them with exact prompts if the assignment reviewer expects verbatim examples.

1. **Evidence-grounded reporting:** ask for structured JSON that follows a Pydantic schema, uses only supplied channel/video metadata and available transcript evidence, includes specific recommendations and marks unavailable evidence instead of guessing.
2. **Debugging model/API failures:** diagnose the Gemini SDK/API compatibility error, verify the supported call pattern and configured model, then test a minimal request before rerunning a real-channel analysis.
3. **Validation reliability:** inspect why a report was rejected for generic or non-specific video feedback; retain strict schema and evidence checks while providing a bounded, source-grounded fallback rather than fabricating an observation.
4. **Deployment integration:** configure the Vercel frontend API base URL to point to the Render Flask API, then verify CORS and health endpoints instead of assuming the frontend's successful build proves the API works.

## Reliability measures

- Use Pydantic models to validate report structure and field types.
- Bound scores to the required 1–10 range.
- Rank videos deterministically from collected metrics rather than asking the model to invent the ranking.
- Require evidence for transcript-based assessments and treat missing transcript evidence as unavailable.
- Keep API keys in environment variables, never in prompts, source files or committed `.env.example` values.
- Treat model output as an assessment, not ground truth; verify claims against the collected source data.
- Use bounded provider timeouts/retries and persist a failed job rather than leaving it processing indefinitely.
- Test against real channel data and inspect the saved report, not just the raw JSON response.

## Example of an error and correction

**Error observed:** an earlier Gemini integration produced an API/SDK compatibility error involving an unsupported Interactions API schema/model configuration. Transient HTTP 503/high-demand responses were also observed.

**Correction approach:** use the supported SDK/API call for the configured model, test a minimal request, set the deployed `GEMINI_MODEL` to the model that worked in the development environment (`gemini-3.5-flash-lite` at the time of the deployment), and rerun the full report flow. Model availability and free-tier quotas can change, so the selected model must be verified at runtime.

**Separate validation issue:** a specificity validator rejected video feedback that lacked a verifiable title detail or metric. The corrective direction was to keep evidence-grounding requirements but generate a conservative fallback tied to the supplied video title and metrics when a required video ID/feedback item is missing. This fallback must not claim that views alone explain creative quality.

## Human review and known limitations

- AI scores are estimates, not objective measurements of creative quality.
- Metadata/transcripts alone cannot support claims about visual composition, editing or audio.
- A valid JSON response is not enough; verify that the content matches the right video and is grounded in source evidence.
- Before submission, record the exact test command and actual result, confirm the deployed model and environment variables, and include only errors that genuinely occurred during this project.
