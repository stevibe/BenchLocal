# BenchLocal Themes

BenchLocal supports built-in and user-defined themes via JSON files.

User themes should be placed in:

`~/.benchlocal/themes/`

Theme file shape:

```json
{
  "schemaVersion": 1,
  "id": "my-theme",
  "name": "My Theme",
  "colorScheme": "light",
  "variables": {
    "--bg": "#f1f2f4",
    "--ink": "#1f2937",
    "--accent": "#2563eb"
  }
}
```

The easiest way to create a custom theme is to copy one of the built-in theme JSON files from this directory and modify the variable values.
