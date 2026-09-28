#!/usr/bin/env bash
set -u
umask 077

TS="$(date +%Y%m%d-%H%M%S)"
OUT="${AUDIT_OUT:-./server-audit-${TS}.txt}"
SEARCH_ROOTS=(/opt /srv /docker /etc /root /home)

section() {
  printf '\n\n================================================================================\n'
  printf '## %s\n' "$1"
  printf '================================================================================\n'
}

redact() {
  sed -E \
    -e 's#([A-Za-z][A-Za-z0-9+.-]*://)[^/@[:space:]]+:[^/@[:space:]]+@#\1***:***@#g' \
    -e '/(PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|DATABASE_URL|REDIS_URL|AUTHORIZATION)/I s#([:=][[:space:]]*).*$#\1***REDACTED***#'
}

safe() {
  "$@" 2>&1 || true
}

{
  section "CABECERA"
  echo "Fecha: $(date --iso-8601=seconds 2>/dev/null || date)"
  echo "Host: $(hostname)"
  echo "Usuario: $(id)"

  section "SISTEMA"
  safe uname -a
  [ -f /etc/os-release ] && safe cat /etc/os-release
  safe free -h
  safe df -hT
  safe lsblk -o NAME,FSTYPE,SIZE,TYPE,MOUNTPOINTS

  section "RED Y PUERTOS"
  safe ip -br addr
  safe ip route
  safe ss -lntup

  section "DOCKER"
  safe docker version
  safe docker info
  safe docker compose version
  safe docker compose ls --all

  section "CONTENEDORES"
  safe docker ps -a --no-trunc --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'

  while read -r id; do
    [ -n "$id" ] || continue
    name="$(docker inspect --format '{{.Name}}' "$id" 2>/dev/null | sed 's#^/##')"
    echo
    echo "### $name"
    docker inspect --format \
'project={{index .Config.Labels "com.docker.compose.project"}}
service={{index .Config.Labels "com.docker.compose.service"}}
working_dir={{index .Config.Labels "com.docker.compose.project.working_dir"}}
config_files={{index .Config.Labels "com.docker.compose.project.config_files"}}
image={{.Config.Image}}
restart={{.HostConfig.RestartPolicy.Name}}
networks={{range $n,$c := .NetworkSettings.Networks}}{{$n}} {{end}}
mounts={{range .Mounts}}{{println .Type "|" .Source "|" .Destination "|" .Name}}{{end}}' "$id" 2>/dev/null | redact

    echo "[labels]"
    docker inspect --format '{{range $k,$v := .Config.Labels}}{{println $k "=" $v}}{{end}}' "$id" 2>/dev/null | redact | sort
    echo "[env names]"
    docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$id" 2>/dev/null \
      | sed -E 's/=.*$/=***REDACTED***/' | sort
  done < <(docker ps -aq 2>/dev/null)

  section "NETWORKS"
  safe docker network ls
  while read -r id; do
    [ -n "$id" ] || continue
    docker network inspect --format \
'Name={{.Name}} Driver={{.Driver}} Internal={{.Internal}} IPAM={{json .IPAM.Config}}
{{range $cid,$c := .Containers}}{{println $c.Name "|" $c.IPv4Address}}{{end}}' "$id" 2>/dev/null
  done < <(docker network ls -q 2>/dev/null)

  section "VOLUMES"
  safe docker volume ls
  while read -r volume; do
    [ -n "$volume" ] || continue
    docker volume inspect --format 'Name={{.Name}} Mountpoint={{.Mountpoint}} Labels={{json .Labels}}' "$volume" 2>/dev/null
    mountpoint="$(docker volume inspect --format '{{.Mountpoint}}' "$volume" 2>/dev/null)"
    [ -d "$mountpoint" ] && du -sh "$mountpoint" 2>/dev/null || true
  done < <(docker volume ls -q 2>/dev/null)

  section "COMPOSE FILES"
  for root in "${SEARCH_ROOTS[@]}"; do
    [ -d "$root" ] || continue
    find "$root" -xdev \
      \( -path '*/node_modules' -o -path '*/.git' -o -path '*/.next' \) -prune -o \
      -type f \
      \( -iname 'compose.yml' -o -iname 'compose.yaml' -o -iname 'docker-compose.yml' -o -iname 'docker-compose.yaml' -o -iname 'docker-compose.*.yml' -o -iname 'docker-compose.*.yaml' \) \
      -print 2>/dev/null
  done | sort -u

  section "PROJECT DIRECTORIES"
  for root in /opt /srv /docker; do
    [ -d "$root" ] || continue
    find "$root" -maxdepth 3 -mindepth 1 \
      \( -path '*/node_modules' -o -path '*/.git' -o -path '*/.next' \) -prune -o \
      -printf '%M %u:%g %s %p\n' 2>/dev/null | head -n 3000
  done

  section "SYSTEMD"
  safe systemctl list-unit-files --type=service --no-pager

  section "CRON"
  safe crontab -l

  section "FIN"
  echo "Revisa manualmente este informe antes de compartirlo."
} > "$OUT" 2>&1

chmod 600 "$OUT"
echo "Informe generado: $OUT"
