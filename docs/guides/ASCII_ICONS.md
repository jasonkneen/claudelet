# ASCII Icon Reference

All emojis have been replaced with clean ASCII characters for better terminal compatibility.

## Icon Mapping

| Old Emoji | New ASCII | Usage |
|-----------|-----------|-------|
| 🤖 | `[*]` | Claudelet branding, app name |
| ✅ | `[+]` | Success, Ready status, Session started |
| ❌ | `[x]` | Errors, failures |
| 💭 | `[...]` | Thinking indicator |
| 🔧 | `[+]` | Tool usage |
| 📬 | `[Q]` | Message queue |
| ⏳ | `[*]` | Waiting/blocked input |
| 🔄 | `[~]` | Responding status |
| 👋 | `[-]` | Goodbye |
| ⏹️ | `[!]` | Response stopped |
| ℹ️ | `[i]` | Info messages |
| 📚 | `[?]` | Help/commands |
| 📎 | `[@]` | File references |

## Visual Examples

### Status Messages
```
[+] Session: a1b2c3d4
[x] Error: Connection failed
[!] Response stopped
[i] No response in progress
[-] Goodbye!
```

### Activity Indicators
```
[...] Thinking...
[+] Using tool: read_file
[Q] 3 messages queued
```

### Status Bar
```
smart-sonnet | [+] Ready
smart-sonnet | [~] Responding
```

### Input Prompt
```
> Type your message...      (ready)
[*] Waiting for response... (blocked)
```

### Help Sections
```
[?] Commands:
/help - Show this help

[@] File References:
@path/to/file - Embed file

[Q] Smart Queue:
Type while responding
```

## Design Rationale

**Why ASCII over Emojis?**
- ✓ Better terminal compatibility (works in all environments)
- ✓ Consistent rendering across platforms
- ✓ Professional appearance
- ✓ Faster rendering
- ✓ No font dependencies
- ✓ Works in minimal/headless terminals
- ✓ Copy/paste friendly
- ✓ Screen reader compatible

**Icon Consistency:**
- `[+]` = positive/success/active
- `[x]` = error/failure/negative
- `[-]` = neutral/exit
- `[*]` = branding/waiting/busy
- `[~]` = processing/in-progress
- `[!]` = warning/stopped
- `[i]` = information
- `[?]` = help/question
- `[@]` = reference/link
- `[Q]` = queue
- `[...]` = thinking/loading

## Future Considerations

If you want even cleaner icons, consider:
- `•` instead of `[*]` for branding
- `×` instead of `[x]` for errors
- `✓` instead of `[+]` for success (if UTF-8 available)
- `→` instead of `[>]` for arrows
- `—` instead of `[-]` for neutral

These require UTF-8 support but are still standard ASCII/Unicode, not emoji.
