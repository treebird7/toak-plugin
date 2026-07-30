// Presence-only fixture. launch.sh probes `[ -f "$ENVOAK_JS" ]` and then runs
// `node "$ENVOAK_JS" vault get …`; under the stub node on PATH that dispatches
// to the vault branch, so this file's contents are never executed. It exists so
// the -f test passes.
process.stdout.write('vault-injected-service-key\n');
