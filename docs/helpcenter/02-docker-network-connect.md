# backupctl Can't Reach a Project's Database — Docker Network Connect Fails

> **TL;DR** — When backupctl can't resolve a project's database host (`getaddrinfo ENOTFOUND postgres-myapp`), the container isn't attached to the project's Docker network. Either the network doesn't exist yet, the Docker socket isn't mounted, or the `node` user inside the container lacks permission on the socket. Run `backupctl network connect <project>` after fixing each layer below.

## Symptom

One of these shows up in logs or in `backupctl run` output:

```
# Database hostname unresolvable
Command "pg_dump" failed: pg_dump: error: connection to server at \
  "postgres-myapp" failed: could not translate host name \
  "postgres-myapp" to address: Name or service not known
```

```
# Network connect command itself failed
Error response from daemon: network myapp_myapp-network not found
```

```
# Permission denied on the Docker socket
Got permission denied while trying to connect to the Docker daemon socket \
  at unix:///var/run/docker.sock
```

![backupctl network connect failure variants](/images/helpcenter/02-network-connect-errors.png)

## Who this affects

- Anyone backing up databases that live in **other** Docker Compose projects on the same host
- First-time deploys, right after adding `docker_network:` to a project in `config/projects.yml`
- After a host reboot where the project's compose stack was brought down and its network removed

## Root cause

backupctl runs in its own Compose stack. Project databases typically live on their project's user-defined network (e.g. `myapp_default`, `myapp_myapp-network`). Docker does not magically bridge containers across user-defined networks — backupctl must be **explicitly attached** to the target network before it can resolve the DB hostname.

The `backupctl network connect` command does this by calling `docker network connect` and `docker network inspect` **from inside the backupctl container**. That in turn requires three prerequisites — the three things this article diagnoses:

1. The target network exists on the host
2. The host's `/var/run/docker.sock` is mounted into the container
3. The `node` user inside the container is in the right supplementary group to read that socket

If any one of those is missing you'll see one of the three symptoms above.

## Diagnose

Work through these in order — each step eliminates one layer.

### 1. Confirm the project declares a `docker_network`

```bash
grep -A1 '^  - name: <project>' /path/to/backupctl/config/projects.yml
```

You should see a `docker_network:` line. If not, add it and `backupctl config reload`:

```yaml
projects:
  - name: my-app
    docker_network: myapp_myapp-network
    database:
      host: postgres-myapp
      port: 5432
```

### 2. Confirm the target network actually exists on the host

```bash
docker network ls --filter name=myapp_myapp-network
```

![docker network ls output](/images/helpcenter/02-network-ls.png)

If it's missing, the project's compose stack isn't up. Start it first:

```bash
cd /path/to/myapp && docker compose up -d
```

### 3. Confirm the Docker socket is mounted inside backupctl

```bash
docker exec backupctl ls -l /var/run/docker.sock
```

Expected:

```
srw-rw---- 1 root docker 0 Apr 19 04:00 /var/run/docker.sock
```

If you instead see `No such file or directory`, the socket isn't mounted. Fix `docker-compose.yml`:

```yaml
services:
  backupctl:
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

### 4. Confirm the container user can read the socket

```bash
docker exec backupctl id
docker exec backupctl docker ps --format '{{.Names}}' | head -3
```

If `docker ps` fails with `permission denied`, the `node` user (UID 1000) doesn't have group permission on the socket. Check the socket's GID on the host:

```bash
stat -c '%g' /var/run/docker.sock
```

Then set that GID via `group_add` in `docker-compose.yml`:

```yaml
services:
  backupctl:
    group_add:
      - '${DOCKER_GID:-999}'
```

And in `.env`:

```env
DOCKER_GID=998   # replace with the value from `stat`
```

Rebuild the stack so `group_add` takes effect:

```bash
docker compose up -d --force-recreate backupctl
```

![fixed: docker ps now works inside the container](/images/helpcenter/02-docker-in-container.png)

### 5. Check current network attachments

```bash
docker inspect backupctl \
  --format '{{range $net, $conf := .NetworkSettings.Networks}}{{$net}}{{"\n"}}{{end}}'
```

The target network should appear in this list **after** you run step 6. If not, the connect failed silently — re-check steps 2-4.

## Short-term workaround

If you need a specific project to back up *right now* and `backupctl network connect` still misbehaves, connect the container manually from the host:

```bash
docker network connect myapp_myapp-network backupctl
backupctl run my-app
```

![manual docker network connect](/images/helpcenter/02-manual-connect.png)

This connection is **lost on container restart** — every time the backupctl container restarts, you have to re-run it. The permanent fix below makes it automatic via `backupctl network connect` on startup.

## Permanent fix

### 1. Wire up all three prerequisites in `docker-compose.yml`

```yaml
services:
  backupctl:
    container_name: backupctl
    build:
      context: .
      dockerfile: Dockerfile
    env_file: .env
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    group_add:
      - '${DOCKER_GID:-999}'
    # …rest of the service…
```

### 2. Confirm `docker_network` is set for every project that needs it

```bash
grep -B1 'docker_network' /path/to/backupctl/config/projects.yml
```

### 3. Connect all projects at once

```bash
backupctl network connect
```

Expected output for a healthy setup:

```
my-app         →  myapp_myapp-network         ✔ connected
other-service  →  other_default               ✔ connected
legacy-db      →  (skipped — no docker_network configured)
```

![successful network connect for all projects](/images/helpcenter/02-network-connect-all.png)

For a single project:

```bash
backupctl network connect my-app
```

### 4. Make it automatic on container restart

Add `backupctl network connect` to your deploy script or container entrypoint so attachments are restored after every restart. If you're using `scripts/backupctl-manage.sh deploy`, it already runs this for you. See [Network](../17-network) for the full lifecycle.

## Prevent recurrence

- **Health-check the connection daily** — `backupctl health` verifies DB reachability as part of its pre-flight. Schedule it or wire it into your monitoring.
- **Don't rely on the other project's network name being stable** — if a teammate renames their compose project, `docker_network:` silently stops matching. Set an alias at the DB side or document the dependency in both repos.
- **Watch `docker-compose.yml` diffs in PRs** — it's easy to drop `volumes:` or `group_add:` during a refactor and not notice until the next cron run.

## Related

- [Network](../17-network) — full Docker network module docs, Docker socket setup, multi-arch image support
- [`network connect` CLI](../06-cli-reference) — command reference, flags, exit codes
- [FAQ: What is docker_network in projects.yml?](../15-faq) — why this field exists
- [FAQ: How to Connect backupctl to Another Docker Compose Project's Database](../15-faq)
