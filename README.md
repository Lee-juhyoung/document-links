# Link document viewer

A static document viewer for links and QR codes. The site itself has no public document index.

Document bytes, filenames, group titles, and document lists are encrypted with AES-256-GCM. Each group has its own random key. Keys are distributed in URL fragments and are not stored in this repository. The public assets use opaque random identifiers. The viewer decrypts locally in the browser and does not use analytics, external scripts, or browser storage for decrypted files.

The encrypted payloads and the generic viewer source are public. The complete link or QR code grants access to its document group. Anyone who receives a complete link can use and reshare it. The viewer requires HTTPS, except for local testing on localhost.

Search exclusion is defense in depth; confidentiality depends on encryption and keeping complete links private. Do not commit source documents, plaintext manifests, QR images, screenshots, or access links to this repository. Keep account access and changes to the viewer under control.

PDF rendering uses a pinned, locally served Mozilla PDF.js distribution. Its license is included in `vendor/LICENSE`.
