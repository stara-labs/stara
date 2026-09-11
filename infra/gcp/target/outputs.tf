output "configuration_sha256" {
  description = "Hash of exact jsonencode bytes written to the private object; publish only the hash as the GitHub configuration identity."
  value       = sha256(local.configuration_json)
}

output "private_target" {
  description = "Private operator wiring and negative-permission drill inputs. Do not upload."
  sensitive   = true
  value = {
    environment              = var.environment
    project_id               = var.project_id
    configuration_uri        = "gs://${google_storage_bucket.config.name}/${google_storage_bucket_object.configuration.name}"
    state_bucket             = google_storage_bucket.state.name
    state_object             = "targets/${var.environment}.json"
    executor_service_account = local.executor
    services                 = { for key, service in google_cloud_run_v2_service.app : key => service.id }
    runtime_service_accounts = { for key, account in google_service_account.runtime : key => account.email }
  }
}

output "dns_records" {
  description = "Operator exports for the existing DNS provider only; isolation emits no records."
  sensitive   = true
  value = var.enable_load_balancer ? [
    {
      name = google_certificate_manager_dns_authorization.staging[0].dns_resource_record[0].name
      type = google_certificate_manager_dns_authorization.staging[0].dns_resource_record[0].type
      data = google_certificate_manager_dns_authorization.staging[0].dns_resource_record[0].data
    },
    {
      name = var.hostname
      type = "A"
      data = google_compute_global_address.staging[0].address
    },
  ] : []
}
