# Conveyor request photographs

These three synthetic field-service photographs are reused from the
`clairon-gtm` technician-briefing fixture at commit `bf5dc38`:

- `att-881-operator-side-belt-edge.webp`
- `att-882-drive-end-spindle.webp`
- `att-883-conveyor-frame-guide.webp`

They seed request `SR-2075`. At runtime, `@human-checkpoint/store` reads the
fixture bytes into SQLite BLOB rows. The dashboard receives only attachment
metadata and loads each image through the authenticated, no-store Node-RED
attachment route. The photographs are reported evidence for technician review;
the agent does not receive or analyze their pixels.
