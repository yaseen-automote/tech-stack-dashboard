# CT Fetch

This workspace resolves daily Certificate Transparency dumps from
`https://cs2.ip.thc.org/`, downloads a selected `.txt.gz` file, computes its
checksum, and writes a manifest for later import.

## Command

```bash
npm run ct:fetch -- --date 2025-11-24 --storage-root ./data
```
