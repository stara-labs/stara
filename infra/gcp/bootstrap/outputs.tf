output "projects" {
  description = "Private operator wiring, including generated project numbers."
  sensitive   = true
  value = {
    for environment, project in google_project.environment : environment => {
      project_id     = project.project_id
      project_number = project.number
      state_bucket   = google_storage_bucket.terraform_state[environment].name
    }
  }
}

output "backend_configuration" {
  description = "Write each entry to a separate private backend file; never supply another target's bucket."
  sensitive   = true
  value = {
    for environment, bucket in google_storage_bucket.terraform_state : environment => {
      bucket = bucket.name
      prefix = "terraform/${environment}"
    }
  }
}

output "budget_notice" {
  value = "USD 100/month combined project budget; alerts at 50%, 80%, and 100%. This is not a spending cap and never automatically shuts down services."
}
