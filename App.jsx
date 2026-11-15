import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Завантаження даних з нашого REST API бекенду
  useEffect(() => {
    fetch('http://localhost:5000/api/products')
      .then(res => res.json())
      .then(data => {
        setProducts(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Помилка завантаження даних:', err);
        setLoading(false);
      });
  }, []);

  return (
    <div className="apple-store-app">
      {/* Навігація */}
      <nav className="apple-nav">
        <span className="logo"> Apple Store UA</span>
        <span>React.js / MongoDB / REST API</span>
      </nav>

      <header className="hero">
        <h1>Лабораторна робота №2</h1>
        <p>Інтерактивний клієнтський інтерфейс та робота з базою даних</p>
      </header>

      <main className="container">
        <section className="catalog-section">
          <h2>Каталог техніки Apple</h2>
          <p className="desc">Динамічний рендеринг даних із хмарної бази даних MongoDB.</p>

          {loading ? (
            <p className="loading">Завантаження товарів...</p>
          ) : (
            <div className="product-grid">
              {products.map(product => (
                <div key={product._id} className="product-card">
                  <span className="product-category">{product.category}</span>
                  <h3>{product.name}</h3>
                  <p className="price">{product.price.toLocaleString()} ₴</p>
                  <span className={`status ${product.inStock ? 'in-stock' : 'out-stock'}`}>
                    {product.inStock ? '✓ В наявності' : '✕ Немає в наявності'}
                  </span>
                  <button 
                    className="buy-btn" 
                    disabled={!product.inStock}
                    onClick={() => alert(`Товар "${product.name}" успішно додано до кошика!`)}
                  >
                    Придбати
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer>
        <p>&copy; 2026 Apple Store Lab. Виконано студенткою.</p>
      </footer>
    </div>
  );
}

export default App;