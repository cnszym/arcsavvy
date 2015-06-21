var arcsavvy = require('./main.js');

explore_recursive('tests', function(n,t,f,c) {
  console.log(t,n);
});

console.log(get_element('./tests/state0/description.txt', 'state0/description.txt'));
console.log(construct_index(construct_file_index('./tests/state5')));
