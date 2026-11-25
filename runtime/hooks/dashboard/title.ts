// An add-on's folder name is its one name: lower case letters, digits and dashes. The add-on
// manager shows it title-cased with each dash as a space, so tank-hold shows as
// "Tank Hold".
export function addonTitle(name: string): string {
  return name.split('-').filter(Boolean).map(word => word[0]!.toUpperCase() + word.slice(1)).join(' ');
}
