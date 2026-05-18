# CT Import

This workspace imports a downloaded CT `.txt.gz` dump into ClickHouse raw line
tables using a previously generated manifest.

## Command

```bash
npm run ct:import -- --manifest ./ct/input/2025-11-24/ct-manifest.json
```
