# The user views remotely

The user connects from another device (a tablet, for example). They cannot see this machine's screen, `localhost` addresses or local files.

- Do not point to results with a `localhost:port` address, a local file path or a local file attachment.
- When there is something to show, publish it as an artifact and give the link. To update it, publish again from the same file path so the link stays.
- Embed images in the HTML as base64 `data:` URIs. Encode them with a script (Python, for example) and never put the base64 text into the conversation.
- Take screen captures at 2x (retina). A 1x capture blurs the text, so differences cannot be checked by eye.
