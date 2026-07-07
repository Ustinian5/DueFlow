# Privacy

DueFlow is designed as a local-first DDL and schedule assistant. The default development configuration uses a mock model provider and does not require an API key.

## Local Data

By default, DueFlow stores data on the user's machine:

- SQLite database files;
- Inbox text and uploaded files;
- extracted draft tasks and confirmed tasks;
- generated plans, risks, Markdown exports and `.ics` files;
- backups and diagnostics exports;
- local desktop pet appearance assets;
- local read-only skill manifests.

Real user-generated versions of these files should not be committed to Git or shared in public issues. Synthetic demo outputs generated from files under `examples/` may be committed when they are intentionally used as reproducible sample artifacts.

## Model Providers

When `LLM_PROVIDER=mock`, DueFlow does not send Inbox content to an external model provider.

When a real OpenAI-compatible provider is configured, the text submitted for extraction or planning may be sent to that provider according to the provider's own API terms and privacy policy. Users are responsible for choosing a provider, setting credentials in `.env`, and deciding whether their data is appropriate to process through that provider.

DueFlow keeps model output behind explicit user confirmation before creating committed tasks.

## OCR And Files

Image and screenshot intake may use:

- the local macOS Vision framework when available;
- an optional command configured through `DUEFLOW_OCR_COMMAND`, such as Tesseract.

Do not configure OCR commands that upload private files unless that is intentional and documented in your own deployment.

Desktop intake also enforces local resource limits for pasted text and uploaded files. The defaults are 200,000 text characters and 25 MiB per uploaded file, with environment-variable overrides documented in `docs/desktop_api.md`.

## Diagnostics

DueFlow diagnostics are intended for troubleshooting without exposing raw personal schedules. Diagnostics omit raw Inbox text, task titles, source quotes and extracted descriptions.

Review diagnostics before sharing them. Do not share API keys, `.env` files, databases, raw Inbox files, private screenshots, calendar exports with sensitive names, or backups in public threads.

## Desktop Pet And Local Assets

Local pet appearances are loaded from manifest-declared local assets. DueFlow rejects remote asset URLs and parent-directory traversal for imported pet appearances.

Third-party pet assets may have their own licenses or privacy implications. Only import assets you have permission to use.

## Future Hosted Features

DueFlow currently does not provide account sync, multi-user hosting, cloud storage or automatic reading of private messaging apps. If hosted or sync features are added later, this privacy document must be updated before release.
