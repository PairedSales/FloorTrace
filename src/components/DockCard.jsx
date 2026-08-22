// The dock's card frame. Shared rather than copied, so a card added later
// cannot arrive with its own heading weight and padding and read as a
// different app half a panel down.
const Card = ({ title, action, children, id }) => (
  <section className="dock-card" id={id}>
    <header className="flex items-center gap-2 px-2.5 py-2 border-b border-line-soft">
      <h3 className="card-heading flex-1">{title}</h3>
      {action}
    </header>
    <div className="p-2.5">{children}</div>
  </section>
);

export default Card;
