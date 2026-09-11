# The one derived value three resources and two outputs share, kept here so the hostname is spelled
# once: the DNS record's name plus the zone's apex is what a browser, a CORS origin and Dokploy's
# certificate all have to agree on.

locals {
  project_hostname = "${var.project_name}.${var.zone_name}"
}
