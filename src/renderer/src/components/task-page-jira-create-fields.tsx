import type React from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { getJiraCreateAllowedValueLabel } from './task-page-jira-create-model'
import type { JiraCreateField } from '../../../shared/types'

type Setter<T> = React.Dispatch<React.SetStateAction<T>>

export type TaskPageJiraCreateFieldsProps = {
  visibleJiraCreateFields: JiraCreateField[]
  newJiraIssueCustomFieldValues: Record<string, string>
  setNewJiraIssueCustomFieldValues: Setter<Record<string, string>>
  newJiraIssueSubmitting: boolean
}

export function TaskPageJiraCreateFields({
  visibleJiraCreateFields,
  newJiraIssueCustomFieldValues,
  setNewJiraIssueCustomFieldValues,
  newJiraIssueSubmitting
}: TaskPageJiraCreateFieldsProps): React.JSX.Element | null {
  if (visibleJiraCreateFields.length === 0) {
    return null
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {visibleJiraCreateFields.map((field) => {
        const fieldValue = newJiraIssueCustomFieldValues[field.key] ?? ''
        return (
          <div key={field.key} className="flex min-w-0 flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">{field.name}</label>
            {field.allowedValues?.length && field.schema?.type !== 'array' ? (
              <Select
                value={fieldValue}
                onValueChange={(value) =>
                  setNewJiraIssueCustomFieldValues((prev) => ({ ...prev, [field.key]: value }))
                }
                disabled={newJiraIssueSubmitting}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={translate(
                      'auto.components.TaskPage.1f0fce91e3',
                      'Select {{value0}}',
                      {
                        value0: field.name
                      }
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {field.allowedValues.map((value) => {
                    const optionValue = value.id ?? value.value ?? value.name ?? ''
                    return optionValue ? (
                      <SelectItem key={optionValue} value={optionValue}>
                        {getJiraCreateAllowedValueLabel(value)}
                      </SelectItem>
                    ) : null
                  })}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={fieldValue}
                onChange={(event) =>
                  setNewJiraIssueCustomFieldValues((prev) => ({
                    ...prev,
                    [field.key]: event.target.value
                  }))
                }
                type={field.schema?.type === 'number' ? 'number' : 'text'}
                placeholder={
                  field.schema?.type === 'array'
                    ? translate('auto.components.TaskPage.56cdb413a2', 'Comma-separated values')
                    : translate('auto.components.TaskPage.919a20dd5b', 'Enter {{value0}}', {
                        value0: field.name
                      })
                }
                disabled={newJiraIssueSubmitting}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
