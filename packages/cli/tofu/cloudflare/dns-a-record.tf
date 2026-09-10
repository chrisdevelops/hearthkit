# The project's hostname, pointed straight at the VPS.
#
# proxied = false on purpose: DNS-only keeps Dokploy's Let's Encrypt HTTP-01 challenge working
# without setting the zone's SSL mode to Full. Turning proxying on later is this one attribute plus
# that zone setting, which this module deliberately does not manage.

resource "cloudflare_dns_record" "project_host" {
  zone_id = var.zone_id
  name    = var.project_name
  type    = "A"
  content = var.host_ip
  ttl     = 300
  proxied = false
  comment = "hearthkit ${var.project_name}"
}
