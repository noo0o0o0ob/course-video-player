export function displayAccountName(event, accounts) {
  const account = accounts.find((item) => item.account_id === event.account_id)
  return (
    account?.user?.name ||
    account?.label ||
    event.account_name ||
    event.user?.name ||
    event.account_username ||
    ''
  )
}
