import { Menu, MenuItem, MenuSep } from './Menu';

/**
 * One of `toolCatalog.js`'s groups as a menu: every row a name, a sentence and
 * its key.
 *
 * Two places hang one — the bar above the plan, and the results panel's outline
 * step — so the rows are built here once. What a row may do right now comes
 * from `useToolRows`, passed in as `rowState`.
 *
 * `omit` leaves rows out for a host that already offers them another way (the
 * panel has its own "Add another outline").
 */

// A leading, trailing or doubled rule is what a menu looks like after one of
// its rows has stood down.
const tidy = (rows) => {
  const out = [];
  for (const row of rows) {
    if (row === '-' && (out.length === 0 || out[out.length - 1] === '-')) continue;
    out.push(row);
  }
  while (out[out.length - 1] === '-') out.pop();
  return out;
};

const TaskMenu = ({
  group,
  rowState,
  onSelect,
  menuGroup = 'bar',
  label = group.title,
  omit = [],
  placement,
  triggerClassName,
}) => {
  const byId = new Map([...group.tools, ...(group.commands ?? [])].map((entry) => [entry.id, entry]));
  const rows = tidy(group.menu
    .filter((id) => !omit.includes(id))
    .map((id) => (id === '-' ? '-' : { entry: byId.get(id), state: rowState(byId.get(id)) }))
    .filter((row) => row === '-' || (row.entry && row.state)));

  return (
    <Menu
      id={group.id}
      group={menuGroup}
      label={label}
      icon={group.icon}
      title={group.hint}
      placement={placement}
      triggerClassName={triggerClassName}
    >
      {rows.map((row, i) => (row === '-'
        ? <MenuSep key={`rule-${i}`} />
        : (
          <MenuItem
            key={row.entry.id}
            icon={row.entry.icon}
            label={row.state.label ?? row.entry.label}
            description={row.state.disabled ? (row.state.reason ?? row.entry.hint) : row.entry.hint}
            keys={row.entry.digit ?? row.entry.keys}
            disabled={row.state.disabled}
            danger={row.entry.danger}
            onSelect={() => onSelect(row.entry.id)}
          />
        )))}
    </Menu>
  );
};

export default TaskMenu;
