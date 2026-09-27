export function nextDay(dateString) {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day + 1)
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
    .join('-')
}

export function buildEventPayload(formData, { forceOpkomst = false } = {}) {
  const actualEndDate = formData.isAllDay ? formData.endDate : formData.startDate
  return {
    title: formData.title.trim(),
    start: formData.isAllDay ? formData.startDate : `${formData.startDate}T${formData.startTime}`,
    end: formData.isAllDay ? nextDay(actualEndDate) : `${actualEndDate}T${formData.endTime}`,
    allDay: formData.isAllDay,
    location: formData.location.trim(),
    description: formData.description.trim(),
    isOpkomst: forceOpkomst || formData.isOpkomst,
    opkomstmakerIds: formData.opkomstmakers || [],
    isSchoonmaak: forceOpkomst ? false : Boolean(formData.isSchoonmaak),
    schoonmakerIds: forceOpkomst ? [] : formData.schoonmakers || [],
    schoonmaakOptions: forceOpkomst ? [] : formData.schoonmaakOptions || []
  }
}
